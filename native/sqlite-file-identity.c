#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>

static int shapepilot_path_exists(const char *path) {
  DWORD attributes = GetFileAttributesA(path);
  return attributes != INVALID_FILE_ATTRIBUTES;
}

typedef struct {
  const sqlite3_io_methods *methods;
  sqlite3_vfs *vfs;
  HANDLE handle;
} ShapePilotFilePrefix;

static int shapepilot_file_identity(
  sqlite3 *database,
  char **error_message
) {
  sqlite3_file *file = 0;
  BY_HANDLE_FILE_INFORMATION info;
  char result[128];
  const char *expected;
  unsigned long long inode;
  unsigned long long size;
  int status;

  status = sqlite3_file_control(
    database, "main", SQLITE_FCNTL_FILE_POINTER, &file);
  if (status != SQLITE_OK || file == 0) {
    *error_message = sqlite3_mprintf("could not obtain SQLite main-file handle");
    return status == SQLITE_OK ? SQLITE_ERROR : status;
  }
  if (!GetFileInformationByHandle(
        ((ShapePilotFilePrefix *)file)->handle, &info)) {
    *error_message = sqlite3_mprintf("could not inspect SQLite file handle");
    return SQLITE_IOERR;
  }

  inode = ((unsigned long long)info.nFileIndexHigh << 32)
    | info.nFileIndexLow;
  size = ((unsigned long long)info.nFileSizeHigh << 32)
    | info.nFileSizeLow;
  snprintf(
    result,
    sizeof(result),
    "%llu:%llu:%llu",
    (unsigned long long)info.dwVolumeSerialNumber,
    inode,
    size);
  expected = getenv("SHAPEPILOT_EXPECTED_SQLITE_FILE_IDENTITY");
  if (expected == 0 || strcmp(expected, result) != 0) {
    *error_message = sqlite3_mprintf("SQLite opened a different database file");
    return SQLITE_CANTOPEN;
  }
  return SQLITE_OK;
}
#else
#include <sys/stat.h>
#include <unistd.h>

static int shapepilot_path_exists(const char *path) {
  struct stat info;
  return stat(path, &info) == 0;
}

/*
 * SQLITE_FCNTL_FILE_POINTER returns SQLite's concrete unixFile. This prefix is
 * pinned to the bundled SQLite layout in better-sqlite3 12.4.1. The build script
 * refuses any other driver version so an upgrade requires an explicit audit.
 */
typedef struct {
  const sqlite3_io_methods *methods;
  sqlite3_vfs *vfs;
  void *inode;
  int descriptor;
} ShapePilotFilePrefix;

static int shapepilot_file_identity(
  sqlite3 *database,
  char **error_message
) {
  sqlite3_file *file = 0;
  struct stat info;
  char result[160];
  const char *expected;
  int status;

  status = sqlite3_file_control(
    database, "main", SQLITE_FCNTL_FILE_POINTER, &file);
  if (status != SQLITE_OK || file == 0) {
    *error_message = sqlite3_mprintf("could not obtain SQLite main-file descriptor");
    return status == SQLITE_OK ? SQLITE_ERROR : status;
  }
  if (fstat(((ShapePilotFilePrefix *)file)->descriptor, &info) != 0) {
    *error_message = sqlite3_mprintf("could not inspect SQLite file descriptor");
    return SQLITE_IOERR;
  }

  snprintf(
    result,
    sizeof(result),
    "%llu:%llu:%llu",
    (unsigned long long)info.st_dev,
    (unsigned long long)info.st_ino,
    (unsigned long long)info.st_size);
  expected = getenv("SHAPEPILOT_EXPECTED_SQLITE_FILE_IDENTITY");
  if (expected == 0 || strcmp(expected, result) != 0) {
    *error_message = sqlite3_mprintf("SQLite opened a different database file");
    return SQLITE_CANTOPEN;
  }
  return SQLITE_OK;
}
#endif

static int shapepilot_refuse_sidecars(char **error_message) {
  const char *database_path = getenv("SHAPEPILOT_SQLITE_DATABASE_PATH");
  static const char *suffixes[] = {"-journal", "-wal", "-shm"};
  unsigned int index;

  if (database_path == 0 || database_path[0] == '\0') {
    *error_message = sqlite3_mprintf("SQLite database path evidence is missing");
    return SQLITE_CANTOPEN;
  }
  for (index = 0; index < sizeof(suffixes) / sizeof(suffixes[0]); index++) {
    char *sidecar = sqlite3_mprintf("%s%s", database_path, suffixes[index]);
    int exists;
    if (sidecar == 0) return SQLITE_NOMEM;
    exists = shapepilot_path_exists(sidecar);
    sqlite3_free(sidecar);
    if (exists) {
      *error_message = sqlite3_mprintf(
        "SQLite authority has an unapproved journal or shared-memory sidecar");
      return SQLITE_CANTOPEN;
    }
  }
  return SQLITE_OK;
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_extension_init(
  sqlite3 *database,
  char **error_message,
  const sqlite3_api_routines *api
) {
  int status;
  SQLITE_EXTENSION_INIT2(api);
  status = shapepilot_refuse_sidecars(error_message);
  if (status != SQLITE_OK) return status;
  return shapepilot_file_identity(database, error_message);
}

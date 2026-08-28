#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/file.h>
#ifdef __linux__
#include <sys/syscall.h>
#endif
#include <unistd.h>

#ifndef O_CLOEXEC
#define O_CLOEXEC 0
#endif

static void fail(const char *message) {
  fprintf(stderr, "%s: %s\n", message, strerror(errno));
  exit(1);
}

static int open_root(void) {
  struct stat details;
  if (fstat(3, &details) != 0 || !S_ISDIR(details.st_mode)) {
    errno = EINVAL;
    fail("inherited artifact root is not a directory");
  }
  int fd = openat(3, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) fail("cannot open artifact store root");
  if (flock(fd, LOCK_EX) != 0) fail("cannot lock artifact store root");
  return fd;
}

static int valid_segment(const char *segment) {
  if (!segment[0]) return 0;
  for (const unsigned char *p = (const unsigned char *)segment; *p; ++p) {
    if ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z')
        || (*p >= '0' && *p <= '9') || *p == '.' || *p == '_' || *p == '-') {
      continue;
    }
    return 0;
  }
  return strcmp(segment, ".") != 0 && strcmp(segment, "..") != 0;
}

static int descend(int root_fd, const char *path, int create) {
  if (!path[0]) {
    int independent = openat(
      root_fd,
      ".",
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    if (independent < 0) fail("cannot open artifact directory");
    return independent;
  }
  char *copy = strdup(path);
  if (!copy) fail("cannot allocate artifact key");
  int current = dup(root_fd);
  if (current < 0) fail("cannot duplicate artifact root");
  char *save = NULL;
  for (char *segment = strtok_r(copy, "/", &save);
       segment != NULL;
       segment = strtok_r(NULL, "/", &save)) {
    if (!valid_segment(segment)) {
      errno = EINVAL;
      fail("invalid artifact key segment");
    }
    if (create && mkdirat(current, segment, 0700) == 0) {
      if (fsync(current) != 0) fail("cannot sync artifact directory");
    } else if (create && errno != EEXIST) {
      fail("cannot create artifact directory");
    }
    int next = openat(current, segment, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0) fail("cannot open artifact directory");
    close(current);
    current = next;
  }
  free(copy);
  return current;
}

static int parent_and_leaf(int root_fd, const char *key, int create, char **leaf) {
  char *copy = strdup(key);
  if (!copy) fail("cannot allocate artifact key");
  char *slash = strrchr(copy, '/');
  const char *parent = "";
  if (slash) {
    *slash = '\0';
    *leaf = strdup(slash + 1);
    parent = copy;
  } else {
    *leaf = strdup(copy);
  }
  if (!*leaf || !valid_segment(*leaf)) {
    errno = EINVAL;
    fail("invalid artifact key leaf");
  }
  int parent_fd = descend(root_fd, parent, create);
  free(copy);
  return parent_fd;
}

static int copy_fd(int source, int destination, unsigned long long *total) {
  unsigned char buffer[1024 * 1024];
  for (;;) {
    ssize_t count = read(source, buffer, sizeof(buffer));
    if (count == 0) return 0;
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    ssize_t offset = 0;
    while (offset < count) {
      ssize_t written = write(destination, buffer + offset, (size_t)(count - offset));
      if (written < 0) {
        if (errno == EINTR) continue;
        return -1;
      }
      offset += written;
    }
    *total += (unsigned long long)count;
  }
}

static int create_temporary(int parent_fd, char *name, size_t name_size) {
  for (unsigned int attempt = 0; attempt < 1000; ++attempt) {
    snprintf(
      name,
      name_size,
      ".shapepilot-tmp-%ld-%u",
      (long)getpid(),
      attempt
    );
    int fd = openat(
      parent_fd,
      name,
      O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
      0600
    );
    if (fd >= 0) return fd;
    if (errno != EEXIST) fail("cannot create temporary artifact object");
  }
  errno = EEXIST;
  fail("cannot reserve a temporary artifact object");
  return -1;
}

static void cleanup_owned(int parent_fd, const char *name, const struct stat *owned) {
  struct stat current;
  if (fstatat(parent_fd, name, &current, AT_SYMLINK_NOFOLLOW) == 0
      && current.st_dev == owned->st_dev && current.st_ino == owned->st_ino) {
    (void)unlinkat(parent_fd, name, 0);
  }
}

static int publish_no_replace(
  int source_parent_fd,
  const char *temporary,
  int destination_parent_fd,
  const char *final_name
) {
#ifdef __linux__
  return (int)syscall(
    SYS_renameat2,
    source_parent_fd,
    temporary,
    destination_parent_fd,
    final_name,
    1
  );
#elif defined(__APPLE__)
  return renameatx_np(
    source_parent_fd,
    temporary,
    destination_parent_fd,
    final_name,
    RENAME_EXCL
  );
#else
#error "artifact-store publication requires Linux renameat2 or macOS renameatx_np"
#endif
}

static int staging_directory(int root_fd) {
  if (mkdirat(root_fd, ".shapepilot-staging", 0700) == 0) {
    if (fsync(root_fd) != 0) fail("cannot sync artifact staging directory");
  } else if (errno != EEXIST) {
    fail("cannot create artifact staging directory");
  }
  int staging = openat(
    root_fd,
    ".shapepilot-staging",
    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
  );
  if (staging < 0) fail("cannot open artifact staging directory");
  return staging;
}

static void cleanup_staging(int staging_fd) {
  int scan_fd = openat(
    staging_fd,
    ".",
    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
  );
  if (scan_fd < 0) fail("cannot scan artifact staging directory");
  DIR *stream = fdopendir(scan_fd);
  if (!stream) fail("cannot scan artifact staging directory");
  struct dirent *entry;
  int changed = 0;
  while ((entry = readdir(stream)) != NULL) {
    if (strncmp(
      entry->d_name,
      ".shapepilot-tmp-",
      sizeof(".shapepilot-tmp-") - 1
    ) != 0) continue;
    struct stat details;
    if (fstatat(staging_fd, entry->d_name, &details, AT_SYMLINK_NOFOLLOW) == 0
        && S_ISREG(details.st_mode)
        && unlinkat(staging_fd, entry->d_name, 0) == 0) {
      changed = 1;
    }
  }
  closedir(stream);
  if (changed && fsync(staging_fd) != 0) fail("cannot sync artifact staging cleanup");
}

static void put_object(int root_fd, const char *key, unsigned long long expected_bytes) {
  char *leaf = NULL;
  int parent_fd = parent_and_leaf(root_fd, key, 1, &leaf);
  int staging_fd = staging_directory(root_fd);
  cleanup_staging(staging_fd);
  char temporary[128];
  int target = create_temporary(staging_fd, temporary, sizeof(temporary));
  struct stat owned;
  if (fstat(target, &owned) != 0) fail("cannot identify created artifact object");
  unsigned long long copied = 0;
  int failed = copy_fd(STDIN_FILENO, target, &copied) != 0 || copied != expected_bytes
    || fsync(target) != 0 || close(target) != 0;
  unsigned char decision = 0;
  if (!failed && (read(4, &decision, 1) != 1 || decision != 'C')) failed = 1;
  int published = 0;
  if (!failed && publish_no_replace(staging_fd, temporary, parent_fd, leaf) != 0) failed = 1;
  else if (!failed) published = 1;
  if (!failed && fsync(parent_fd) != 0) failed = 1;
  if (failed) {
    cleanup_owned(published ? parent_fd : staging_fd, published ? leaf : temporary, &owned);
    (void)fsync(parent_fd);
    fail("cannot write artifact object");
  }
  // The final parent has already been synced, so publication is durable. A
  // staging-directory sync failure can at worst resurrect the unpublished name
  // after a crash; the next locked operation scavenges it.
  (void)fsync(staging_fd);
  close(staging_fd);
  close(parent_fd);
  free(leaf);
}

static void get_object(int root_fd, const char *key) {
  char *leaf = NULL;
  int parent_fd = parent_and_leaf(root_fd, key, 0, &leaf);
  int source = openat(parent_fd, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (source < 0) fail("cannot open artifact object");
  struct stat details;
  if (fstat(source, &details) != 0 || !S_ISREG(details.st_mode)) {
    errno = EINVAL;
    fail("artifact object is not a regular file");
  }
  unsigned long long copied = 0;
  if (copy_fd(source, STDOUT_FILENO, &copied) != 0) fail("cannot read artifact object");
  close(source);
  close(parent_fd);
  free(leaf);
}

static int copy_and_echo(int source, int destination, unsigned long long *total) {
  unsigned char buffer[1024 * 1024];
  for (;;) {
    ssize_t count = read(source, buffer, sizeof(buffer));
    if (count == 0) return 0;
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    for (int output_index = 0; output_index < 2; ++output_index) {
      int output = output_index == 0 ? destination : STDOUT_FILENO;
      ssize_t offset = 0;
      while (offset < count) {
        ssize_t written = write(output, buffer + offset, (size_t)(count - offset));
        if (written < 0) {
          if (errno == EINTR) continue;
          return -1;
        }
        offset += written;
      }
    }
    *total += (unsigned long long)count;
  }
}

static void fetch_object(int root_fd, const char *key, const char *destination_leaf) {
  if (!valid_segment(destination_leaf)) {
    errno = EINVAL;
    fail("invalid destination leaf");
  }
  struct stat parent_details;
  if (fstat(4, &parent_details) != 0 || !S_ISDIR(parent_details.st_mode)) {
    errno = EINVAL;
    fail("destination parent descriptor is not a directory");
  }

  char *source_leaf = NULL;
  int source_parent = parent_and_leaf(root_fd, key, 0, &source_leaf);
  int source = openat(source_parent, source_leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (source < 0) fail("cannot open artifact object");
  struct stat source_details;
  if (fstat(source, &source_details) != 0 || !S_ISREG(source_details.st_mode)) {
    errno = EINVAL;
    fail("artifact object is not a regular file");
  }

  int target = openat(
    4,
    destination_leaf,
    O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
    0600
  );
  if (target < 0) fail("cannot create materialized artifact");
  struct stat owned;
  if (fstat(target, &owned) != 0) fail("cannot identify materialized artifact");
  unsigned long long copied = 0;
  int failed = copy_and_echo(source, target, &copied) != 0
    || copied != (unsigned long long)source_details.st_size
    || fsync(target) != 0 || close(target) != 0;
  struct stat current;
  if (!failed && (fstatat(4, destination_leaf, &current, AT_SYMLINK_NOFOLLOW) != 0
      || current.st_dev != owned.st_dev || current.st_ino != owned.st_ino)) {
    failed = 1;
  }
  if (failed) fail("cannot materialize artifact object");
  close(source);
  close(source_parent);
  free(source_leaf);
}

static void list_objects(int root_fd, const char *prefix) {
  int directory = descend(root_fd, prefix, 0);
  DIR *stream = fdopendir(directory);
  if (!stream) fail("cannot list artifact directory");
  struct dirent *entry;
  while ((entry = readdir(stream)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    if (!prefix[0] && strcmp(entry->d_name, ".shapepilot-staging") == 0) continue;
    if (printf("%s\n", entry->d_name) < 0) fail("cannot write artifact listing");
  }
  closedir(stream);
}

int main(int argc, char **argv) {
  signal(SIGPIPE, SIG_IGN);
  if (argc < 3 || argc > 4) {
    fprintf(stderr, "usage: artifact-store-guard <put|get|list|fetch> <key> [value]\n");
    return 2;
  }
  int root_fd = open_root();
  int staging_fd = staging_directory(root_fd);
  cleanup_staging(staging_fd);
  close(staging_fd);
  if (strcmp(argv[1], "put") == 0) {
    if (argc != 4) {
      fprintf(stderr, "put requires an expected byte length\n");
      return 2;
    }
    char *end = NULL;
    errno = 0;
    unsigned long long expected = strtoull(argv[3], &end, 10);
    if (errno != 0 || !end || *end != '\0') {
      fprintf(stderr, "invalid expected byte length\n");
      return 2;
    }
    put_object(root_fd, argv[2], expected);
  }
  else if (strcmp(argv[1], "get") == 0) get_object(root_fd, argv[2]);
  else if (strcmp(argv[1], "list") == 0) list_objects(root_fd, argv[2]);
  else if (strcmp(argv[1], "fetch") == 0 && argc == 4) fetch_object(root_fd, argv[2], argv[3]);
  else {
    fprintf(stderr, "unknown artifact-store operation\n");
    return 2;
  }
  close(root_fd);
  return 0;
}

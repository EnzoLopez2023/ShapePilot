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
  if (strcmp(segment, ".shapepilot-staging") == 0
      || strncmp(
        segment,
        ".shapepilot-tmp-",
        sizeof(".shapepilot-tmp-") - 1
      ) == 0
      || strncmp(
        segment,
        ".shapepilot-bundle-",
        sizeof(".shapepilot-bundle-") - 1
      ) == 0) return 0;
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

static void cleanup_incomplete_bundles(int root_fd) {
  int scan_fd = openat(root_fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (scan_fd < 0) fail("cannot scan artifact root");
  DIR *stream = fdopendir(scan_fd);
  if (!stream) fail("cannot scan artifact root");
  struct dirent *entry;
  int changed = 0;
  while ((entry = readdir(stream)) != NULL) {
    if (strncmp(
      entry->d_name,
      ".shapepilot-bundle-",
      sizeof(".shapepilot-bundle-") - 1
    ) != 0) continue;
    int bundle_fd = openat(
      root_fd,
      entry->d_name,
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    if (bundle_fd < 0) continue;
    int contents_fd = openat(bundle_fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    DIR *contents = contents_fd < 0 ? NULL : fdopendir(contents_fd);
    if (contents) {
      struct dirent *item;
      while ((item = readdir(contents)) != NULL) {
        if (strcmp(item->d_name, ".") == 0 || strcmp(item->d_name, "..") == 0) continue;
        struct stat details;
        if (fstatat(bundle_fd, item->d_name, &details, AT_SYMLINK_NOFOLLOW) == 0
            && S_ISREG(details.st_mode)) {
          (void)unlinkat(bundle_fd, item->d_name, 0);
        }
      }
      closedir(contents);
    }
    close(bundle_fd);
    if (unlinkat(root_fd, entry->d_name, AT_REMOVEDIR) == 0) changed = 1;
  }
  closedir(stream);
  if (changed && fsync(root_fd) != 0) fail("cannot sync incomplete bundle cleanup");
}

static int copy_and_echo_bounded(
  int source,
  int destination,
  unsigned long long expected,
  unsigned long long *total
);

static void cleanup_bundle(
  int root_fd,
  const char *name,
  int bundle_fd,
  const struct stat *owned_bundle,
  int file_count,
  char **file_names,
  struct stat *owned_files
) {
  for (int index = 0; index < file_count; ++index) {
    if (owned_files[index].st_ino != 0) {
      cleanup_owned(bundle_fd, file_names[index], &owned_files[index]);
    }
  }
  (void)fsync(bundle_fd);
  struct stat current;
  if (fstatat(root_fd, name, &current, AT_SYMLINK_NOFOLLOW) == 0
      && current.st_dev == owned_bundle->st_dev
      && current.st_ino == owned_bundle->st_ino) {
    (void)unlinkat(root_fd, name, AT_REMOVEDIR);
  }
  (void)fsync(root_fd);
}

static int bundle_path_matches(
  int parent_fd,
  const char *name,
  const struct stat *owned_bundle
) {
  struct stat current;
  return fstatat(parent_fd, name, &current, AT_SYMLINK_NOFOLLOW) == 0
    && S_ISDIR(current.st_mode)
    && current.st_dev == owned_bundle->st_dev
    && current.st_ino == owned_bundle->st_ino;
}

static int same_file_snapshot(const struct stat *left, const struct stat *right) {
  if (left->st_dev != right->st_dev || left->st_ino != right->st_ino
      || left->st_size != right->st_size || left->st_mode != right->st_mode) return 0;
#ifdef __APPLE__
  return left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec
    && left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec
    && left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec
    && left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
#else
  return left->st_mtim.tv_sec == right->st_mtim.tv_sec
    && left->st_mtim.tv_nsec == right->st_mtim.tv_nsec
    && left->st_ctim.tv_sec == right->st_ctim.tv_sec
    && left->st_ctim.tv_nsec == right->st_ctim.tv_nsec;
#endif
}

static int bundle_contents_match(
  int bundle_fd,
  int file_count,
  char **file_names,
  struct stat *owned_files
) {
  int scan_fd = openat(
    bundle_fd,
    ".",
    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
  );
  if (scan_fd < 0) return 0;
  DIR *stream = fdopendir(scan_fd);
  if (!stream) {
    close(scan_fd);
    return 0;
  }
  int entries = 0;
  errno = 0;
  struct dirent *entry;
  while ((entry = readdir(stream)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    entries += 1;
  }
  int scan_error = errno;
  closedir(stream);
  if (scan_error != 0 || entries != file_count) return 0;

  for (int index = 0; index < file_count; ++index) {
    struct stat current;
    if (fstatat(bundle_fd, file_names[index], &current, AT_SYMLINK_NOFOLLOW) != 0
        || !S_ISREG(current.st_mode)
        || !same_file_snapshot(&current, &owned_files[index])) return 0;
  }
  return 1;
}

static void rollback_published_bundle(
  int root_fd,
  const char *bundle_name,
  const char *staging_name,
  int bundle_fd,
  const struct stat *owned_bundle,
  int file_count,
  char **file_names,
  struct stat *owned_files
) {
  if (!bundle_path_matches(root_fd, bundle_name, owned_bundle)) return;
  if (publish_no_replace(root_fd, bundle_name, root_fd, staging_name) != 0) return;
  if (!bundle_path_matches(root_fd, staging_name, owned_bundle)) return;
  cleanup_bundle(
    root_fd,
    staging_name,
    bundle_fd,
    owned_bundle,
    file_count,
    file_names,
    owned_files
  );
}

static void bundle_object(
  int root_fd,
  const char *bundle_name,
  int file_count,
  char **file_names,
  unsigned long long *expected_sizes
) {
  if (!valid_segment(bundle_name)) {
    errno = EINVAL;
    fail("invalid artifact bundle name");
  }
  char staging_name[128];
  int staging_fd = -1;
  struct stat owned_bundle;
  memset(&owned_bundle, 0, sizeof(owned_bundle));
  struct stat *owned_files = calloc((size_t)file_count, sizeof(struct stat));
  if (!owned_files) fail("cannot allocate artifact bundle identities");
  for (unsigned int attempt = 0; attempt < 1000; ++attempt) {
    snprintf(
      staging_name,
      sizeof(staging_name),
      ".shapepilot-bundle-%ld-%u",
      (long)getpid(),
      attempt
    );
    if (mkdirat(root_fd, staging_name, 0700) == 0) {
      staging_fd = openat(
        root_fd,
        staging_name,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
      );
      if (staging_fd < 0) {
        int saved = errno;
        (void)unlinkat(root_fd, staging_name, AT_REMOVEDIR);
        free(owned_files);
        errno = saved;
        fail("cannot open staged artifact bundle");
      }
      if (fstat(staging_fd, &owned_bundle) != 0) {
        int saved = errno;
        close(staging_fd);
        (void)unlinkat(root_fd, staging_name, AT_REMOVEDIR);
        free(owned_files);
        errno = saved;
        fail("cannot identify staged artifact bundle");
      }
      break;
    }
    if (errno != EEXIST) fail("cannot create staged artifact bundle");
  }
  if (staging_fd < 0) {
    free(owned_files);
    errno = EEXIST;
    fail("cannot reserve staged artifact bundle");
  }

  int saved_error = 0;
  for (int index = 0; index < file_count; ++index) {
    const char *name = file_names[index];
    if (!valid_segment(name)) {
      saved_error = EINVAL;
      goto failed;
    }
    int source = 5 + index;
    struct stat before;
    if (fstat(source, &before) != 0 || !S_ISREG(before.st_mode)
        || before.st_size < 0
        || (unsigned long long)before.st_size != expected_sizes[index]) {
      saved_error = EINVAL;
      goto failed;
    }
    int target = openat(
      staging_fd,
      name,
      O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
      0600
    );
    if (target < 0) {
      saved_error = errno;
      goto failed;
    }
    if (fstat(target, &owned_files[index]) != 0) {
      saved_error = errno;
      close(target);
      goto failed;
    }
    unsigned long long copied = 0;
    struct stat after;
    struct stat completed;
    if (copy_and_echo_bounded(source, target, expected_sizes[index], &copied) != 0
        || copied != expected_sizes[index]
        || fstat(source, &after) != 0
        || before.st_dev != after.st_dev || before.st_ino != after.st_ino
        || after.st_size < 0 || (unsigned long long)after.st_size != expected_sizes[index]
        || fsync(target) != 0
        || fstat(target, &completed) != 0) {
      saved_error = errno ? errno : EIO;
      close(target);
      goto failed;
    }
    owned_files[index] = completed;
    if (close(target) != 0) {
      saved_error = errno;
      goto failed;
    }
    struct stat named;
    if (fstatat(staging_fd, name, &named, AT_SYMLINK_NOFOLLOW) != 0
        || !same_file_snapshot(&named, &owned_files[index])) {
      saved_error = errno ? errno : ESTALE;
      goto failed;
    }
  }
  if (fsync(staging_fd) != 0) {
    saved_error = errno;
    goto failed;
  }
  unsigned char decision = 0;
  if (read(4, &decision, 1) != 1 || decision != 'C') {
    saved_error = ECANCELED;
    goto failed;
  }
  if (!bundle_path_matches(root_fd, staging_name, &owned_bundle)
      || !bundle_contents_match(staging_fd, file_count, file_names, owned_files)) {
    saved_error = ESTALE;
    goto failed;
  }
  if (publish_no_replace(root_fd, staging_name, root_fd, bundle_name) != 0) {
    saved_error = errno;
    goto failed;
  }
  if (!bundle_path_matches(root_fd, bundle_name, &owned_bundle)
      || !bundle_contents_match(staging_fd, file_count, file_names, owned_files)) {
    saved_error = ESTALE;
    goto published_failed;
  }
  if (fsync(root_fd) != 0) {
    saved_error = errno;
    goto published_failed;
  }
  if (!bundle_path_matches(root_fd, bundle_name, &owned_bundle)
      || !bundle_contents_match(staging_fd, file_count, file_names, owned_files)) {
    saved_error = ESTALE;
    goto published_failed;
  }
  close(staging_fd);
  free(owned_files);
  return;

published_failed:
  rollback_published_bundle(
    root_fd,
    bundle_name,
    staging_name,
    staging_fd,
    &owned_bundle,
    file_count,
    file_names,
    owned_files
  );
  close(staging_fd);
  free(owned_files);
  errno = saved_error ? saved_error : EIO;
  fail("cannot commit artifact bundle");

failed:
  cleanup_bundle(
    root_fd,
    staging_name,
    staging_fd,
    &owned_bundle,
    file_count,
    file_names,
    owned_files
  );
  close(staging_fd);
  free(owned_files);
  errno = saved_error ? saved_error : EIO;
  fail("cannot stage artifact bundle");
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

static int copy_and_echo_bounded(
  int source,
  int destination,
  unsigned long long expected,
  unsigned long long *total
) {
  unsigned char buffer[1024 * 1024];
  while (*total < expected) {
    unsigned long long remaining = expected - *total;
    size_t request = remaining < sizeof(buffer) ? (size_t)remaining : sizeof(buffer);
    ssize_t count = read(source, buffer, request);
    if (count == 0) {
      errno = EIO;
      return -1;
    }
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
  unsigned char extra;
  for (;;) {
    ssize_t count = read(source, &extra, 1);
    if (count == 0) return 0;
    if (count > 0) {
      errno = EFBIG;
      return -1;
    }
    if (errno != EINTR) return -1;
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
  if (fstat(source, &source_details) != 0 || !S_ISREG(source_details.st_mode)
      || source_details.st_size < 0) {
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
  int failed = copy_and_echo_bounded(
      source,
      target,
      (unsigned long long)source_details.st_size,
      &copied
    ) != 0
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
    if (!prefix[0] && strncmp(
      entry->d_name,
      ".shapepilot-bundle-",
      sizeof(".shapepilot-bundle-") - 1
    ) == 0) continue;
    if (printf("%s\n", entry->d_name) < 0) fail("cannot write artifact listing");
  }
  closedir(stream);
}

int main(int argc, char **argv) {
  signal(SIGPIPE, SIG_IGN);
  if (argc < 3) {
    fprintf(stderr, "usage: artifact-store-guard <operation> <key> [value...]\n");
    return 2;
  }
  int root_fd = open_root();
  int staging_fd = staging_directory(root_fd);
  cleanup_staging(staging_fd);
  close(staging_fd);
  cleanup_incomplete_bundles(root_fd);
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
  else if (strcmp(argv[1], "bundle") == 0 && argc >= 5 && (argc - 3) % 2 == 0) {
    int file_count = (argc - 3) / 2;
    char **names = calloc((size_t)file_count, sizeof(char *));
    unsigned long long *sizes = calloc((size_t)file_count, sizeof(unsigned long long));
    if (!names || !sizes) fail("cannot allocate artifact bundle arguments");
    for (int index = 0; index < file_count; ++index) {
      names[index] = argv[3 + index * 2];
      char *end = NULL;
      errno = 0;
      sizes[index] = strtoull(argv[4 + index * 2], &end, 10);
      if (errno != 0 || !end || *end != '\0') {
        fprintf(stderr, "invalid artifact bundle byte length\n");
        return 2;
      }
    }
    bundle_object(root_fd, argv[2], file_count, names, sizes);
    free(sizes);
    free(names);
  }
  else {
    fprintf(stderr, "unknown artifact-store operation\n");
    return 2;
  }
  close(root_fd);
  return 0;
}

#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
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

/*
 * SHA-256, FIPS 180-4, self-contained.
 *
 * The guard links no libraries -- scripts/build-native.ts compiles it with a
 * bare `cc -std=c11 -O2` -- and it needs a content digest for the reason given
 * on `bundle_contents_match`: on a network filesystem a file's identity cannot
 * be re-established from its stat fields, so it has to be re-established from
 * its bytes. Small enough to audit in one sitting, and pinned by the published
 * test vectors in test/parity/recovery.test.ts.
 */
#define SHA256_DIGEST_BYTES 32

typedef struct {
  uint32_t state[8];
  uint64_t bits;
  unsigned char buffer[64];
  size_t pending;
} sha256_context;

static const uint32_t SHA256_K[64] = {
  0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
  0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
  0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
  0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
  0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
  0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
  0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
  0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
  0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
  0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
  0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

static uint32_t sha256_rotate(uint32_t value, unsigned int bits) {
  return (value >> bits) | (value << (32 - bits));
}

static void sha256_compress(uint32_t *state, const unsigned char *block) {
  uint32_t w[64];
  for (int index = 0; index < 16; ++index) {
    w[index] = ((uint32_t)block[index * 4] << 24)
      | ((uint32_t)block[index * 4 + 1] << 16)
      | ((uint32_t)block[index * 4 + 2] << 8)
      | (uint32_t)block[index * 4 + 3];
  }
  for (int index = 16; index < 64; ++index) {
    uint32_t s0 = sha256_rotate(w[index - 15], 7) ^ sha256_rotate(w[index - 15], 18)
      ^ (w[index - 15] >> 3);
    uint32_t s1 = sha256_rotate(w[index - 2], 17) ^ sha256_rotate(w[index - 2], 19)
      ^ (w[index - 2] >> 10);
    w[index] = w[index - 16] + s0 + w[index - 7] + s1;
  }
  uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
  uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
  for (int index = 0; index < 64; ++index) {
    uint32_t s1 = sha256_rotate(e, 6) ^ sha256_rotate(e, 11) ^ sha256_rotate(e, 25);
    uint32_t choose = (e & f) ^ ((~e) & g);
    uint32_t temp1 = h + s1 + choose + SHA256_K[index] + w[index];
    uint32_t s0 = sha256_rotate(a, 2) ^ sha256_rotate(a, 13) ^ sha256_rotate(a, 22);
    uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
    uint32_t temp2 = s0 + majority;
    h = g; g = f; f = e; e = d + temp1;
    d = c; c = b; b = a; a = temp1 + temp2;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d;
  state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

static void sha256_begin(sha256_context *context) {
  context->state[0] = 0x6a09e667u; context->state[1] = 0xbb67ae85u;
  context->state[2] = 0x3c6ef372u; context->state[3] = 0xa54ff53au;
  context->state[4] = 0x510e527fu; context->state[5] = 0x9b05688cu;
  context->state[6] = 0x1f83d9abu; context->state[7] = 0x5be0cd19u;
  context->bits = 0;
  context->pending = 0;
}

static void sha256_add(sha256_context *context, const unsigned char *data, size_t length) {
  context->bits += (uint64_t)length * 8;
  while (length > 0) {
    size_t room = 64 - context->pending;
    size_t take = length < room ? length : room;
    memcpy(context->buffer + context->pending, data, take);
    context->pending += take;
    data += take;
    length -= take;
    if (context->pending == 64) {
      sha256_compress(context->state, context->buffer);
      context->pending = 0;
    }
  }
}

static void sha256_finish(sha256_context *context, unsigned char *digest) {
  uint64_t bits = context->bits;
  unsigned char padding = 0x80;
  sha256_add(context, &padding, 1);
  unsigned char zero = 0;
  while (context->pending != 56) sha256_add(context, &zero, 1);
  unsigned char tail[8];
  for (int index = 0; index < 8; ++index) tail[index] = (unsigned char)(bits >> (56 - index * 8));
  // Length is appended directly: sha256_add would fold it back into `bits`.
  memcpy(context->buffer + context->pending, tail, 8);
  sha256_compress(context->state, context->buffer);
  context->pending = 0;
  for (int index = 0; index < 8; ++index) {
    digest[index * 4] = (unsigned char)(context->state[index] >> 24);
    digest[index * 4 + 1] = (unsigned char)(context->state[index] >> 16);
    digest[index * 4 + 2] = (unsigned char)(context->state[index] >> 8);
    digest[index * 4 + 3] = (unsigned char)context->state[index];
  }
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

/** `written` may be NULL for copies whose bytes nobody has to vouch for. */
static int copy_fd(
  int source, int destination, unsigned long long *total, sha256_context *written
) {
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
    if (written) sha256_add(written, buffer, (size_t)count);
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
  unsigned long long *total,
  sha256_context *written
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

/**
 * Re-establish a staged file's identity from its bytes rather than its stat
 * fields, and report the digest it actually has.
 *
 * The stat-identity checks this replaces on the bundle path could not hold on
 * a network filesystem: Azure Files synthesizes inode numbers, reports a fixed
 * mode, and lets the server rewrite timestamps on close, so `fstat` on the
 * open descriptor and `fstatat` on the same path legitimately disagree and a
 * sound write was refused after the bytes were already down. Content is the
 * one identity that survives the mount, and it is a stronger claim: an inode
 * match only says "the same file", while a digest match says "the same bytes".
 *
 * O_NOFOLLOW still refuses a symlink swapped in for the name, and the size is
 * checked before the read so a grown file cannot be streamed unbounded.
 */
static int hash_file_at(
  int parent_fd,
  const char *name,
  unsigned long long expected,
  unsigned char *digest
) {
  int fd = openat(parent_fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat details;
  if (fstat(fd, &details) != 0) {
    int saved = errno;
    close(fd);
    errno = saved;
    return -1;
  }
  if (!S_ISREG(details.st_mode) || details.st_size < 0
      || (unsigned long long)details.st_size != expected) {
    close(fd);
    errno = ESTALE;
    return -1;
  }
  sha256_context context;
  sha256_begin(&context);
  unsigned char buffer[1024 * 1024];
  unsigned long long seen = 0;
  for (;;) {
    ssize_t count = read(fd, buffer, sizeof(buffer));
    if (count == 0) break;
    if (count < 0) {
      if (errno == EINTR) continue;
      int saved = errno;
      close(fd);
      errno = saved;
      return -1;
    }
    seen += (unsigned long long)count;
    if (seen > expected) {
      close(fd);
      errno = ESTALE;
      return -1;
    }
    sha256_add(&context, buffer, (size_t)count);
  }
  close(fd);
  if (seen != expected) {
    errno = ESTALE;
    return -1;
  }
  sha256_finish(&context, digest);
  return 0;
}

/**
 * The name still resolves to a directory, and not through a symlink.
 *
 * The bundle's inode is no more stable than its files' (see `hash_file_at`),
 * so directory identity is no longer asserted here. It is not lost: what the
 * caller needs to know is that this name holds exactly the approved entries
 * with the approved bytes, and `bundle_contents_match` establishes that from
 * the contents themselves. A directory swapped for one holding the same names
 * and the same bytes is, for publication, the same bundle.
 */
static int bundle_contents_match(
  int bundle_fd,
  int file_count,
  char **file_names,
  unsigned long long *expected_sizes,
  unsigned char (*approved)[SHA256_DIGEST_BYTES]
);

static int bundle_path_matches(int parent_fd, const char *name) {
  struct stat current;
  return fstatat(parent_fd, name, &current, AT_SYMLINK_NOFOLLOW) == 0
    && S_ISDIR(current.st_mode);
}

/**
 * The bundle *at this name* holds exactly the approved entries and bytes.
 *
 * Resolving the name afresh is the point. A retained descriptor keeps pointing
 * at the directory that was staged even after that directory has been renamed
 * away and an impostor put at its name -- and it is the name that publication
 * moves. Checking the descriptor would therefore vouch for one directory while
 * publishing another, which is the race `bundle_path_matches` used to catch
 * with the staging inode before an inode could no longer be relied on.
 */
static int bundle_name_contents_match(
  int parent_fd,
  const char *name,
  int file_count,
  char **file_names,
  unsigned long long *expected_sizes,
  unsigned char (*approved)[SHA256_DIGEST_BYTES]
) {
  int fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return 0;
  int matched = bundle_contents_match(fd, file_count, file_names, expected_sizes, approved);
  close(fd);
  return matched;
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
  unsigned long long *expected_sizes,
  unsigned char (*approved)[SHA256_DIGEST_BYTES]
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
    unsigned char current[SHA256_DIGEST_BYTES];
    if (hash_file_at(bundle_fd, file_names[index], expected_sizes[index], current) != 0
        || memcmp(current, approved[index], SHA256_DIGEST_BYTES) != 0) return 0;
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
  if (!bundle_path_matches(root_fd, bundle_name)) return;
  if (publish_no_replace(root_fd, bundle_name, root_fd, staging_name) != 0) return;
  if (!bundle_path_matches(root_fd, staging_name)) return;
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
  /* The digest each staged file is required to have from here on. Read back
   * off the disk after fsync, so it attests the bytes that landed rather than
   * the bytes that were sent. */
  unsigned char (*approved)[SHA256_DIGEST_BYTES]
    = calloc((size_t)file_count, SHA256_DIGEST_BYTES);
  if (!approved) {
    free(owned_files);
    fail("cannot allocate artifact bundle digests");
  }
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
        free(approved);
        errno = saved;
        fail("cannot open staged artifact bundle");
      }
      if (fstat(staging_fd, &owned_bundle) != 0) {
        int saved = errno;
        close(staging_fd);
        (void)unlinkat(root_fd, staging_name, AT_REMOVEDIR);
        free(owned_files);
        free(approved);
        errno = saved;
        fail("cannot identify staged artifact bundle");
      }
      break;
    }
    if (errno != EEXIST) fail("cannot create staged artifact bundle");
  }
  if (staging_fd < 0) {
    free(owned_files);
    free(approved);
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
    sha256_context written;
    sha256_begin(&written);
    if (copy_and_echo_bounded(source, target, expected_sizes[index], &copied, &written) != 0
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
    unsigned char sent[SHA256_DIGEST_BYTES];
    sha256_finish(&written, sent);
    if (hash_file_at(staging_fd, name, expected_sizes[index], approved[index]) != 0) {
      saved_error = errno ? errno : ESTALE;
      goto failed;
    }
    if (memcmp(approved[index], sent, SHA256_DIGEST_BYTES) != 0) {
      saved_error = ESTALE;
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
  if (!bundle_path_matches(root_fd, staging_name)
      || !bundle_name_contents_match(
        root_fd, staging_name, file_count, file_names, expected_sizes, approved)) {
    saved_error = ESTALE;
    goto failed;
  }
  if (publish_no_replace(root_fd, staging_name, root_fd, bundle_name) != 0) {
    saved_error = errno;
    goto failed;
  }
  if (!bundle_path_matches(root_fd, bundle_name)
      || !bundle_name_contents_match(
        root_fd, bundle_name, file_count, file_names, expected_sizes, approved)) {
    saved_error = ESTALE;
    goto published_failed;
  }
  if (fsync(root_fd) != 0) {
    saved_error = errno;
    goto published_failed;
  }
  if (!bundle_path_matches(root_fd, bundle_name)
      || !bundle_name_contents_match(
        root_fd, bundle_name, file_count, file_names, expected_sizes, approved)) {
    saved_error = ESTALE;
    goto published_failed;
  }
  close(staging_fd);
  free(owned_files);
  free(approved);
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
  free(approved);
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
  free(approved);
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

  // Every step below used to funnel into one message printed with whatever
  // errno happened to hold. Both `descend` and `staging_directory` reach here
  // through a perfectly normal mkdirat that returned EEXIST, so that residue
  // reported "File exists" for failures that had nothing to do with an
  // existing file. errno is cleared, and each step says which one it was:
  // "Success" now means an invariant was violated rather than a syscall
  // refused, which is exactly the distinction a reader needs.
  errno = 0;
  const char *why = NULL;
  unsigned long long copied = 0;
  int failed = 0;
  // The digest of what was written, and from here on the object's identity.
  // See `hash_file_at` for why the stat fields this replaces cannot carry it.
  sha256_context writing;
  sha256_begin(&writing);
  unsigned char approved[SHA256_DIGEST_BYTES];
  if (copy_fd(STDIN_FILENO, target, &copied, &writing) != 0 || copied != expected_bytes) {
    failed = 1;
    why = "cannot copy the artifact object";
  }
  if (!failed && fsync(target) != 0) {
    failed = 1;
    why = "cannot sync the artifact object";
  }
  struct stat completed;
  if (!failed) {
    if (fstat(target, &completed) != 0) {
      failed = 1;
      why = "cannot restat the written artifact object";
    } else if (!S_ISREG(completed.st_mode)
        || completed.st_dev != owned.st_dev
        || completed.st_ino != owned.st_ino
        || completed.st_size < 0
        || (unsigned long long)completed.st_size != expected_bytes) {
      failed = 1;
      why = "the artifact object changed identity while it was written";
      errno = 0;
    } else {
      owned = completed;
      sha256_finish(&writing, approved);
    }
  }
  if (close(target) != 0) {
    if (!failed) why = "cannot close the artifact object";
    failed = 1;
  }
  unsigned char decision = 0;
  if (!failed && (read(4, &decision, 1) != 1 || decision != 'C')) {
    failed = 1;
    why = "the artifact write was not committed";
  }
  int published = 0;
  if (!failed) {
    // Identity from the bytes, not from dev/ino/mtime. This comparison used to
    // be `fstat` on the open descriptor against `fstatat` on the same path,
    // which is precisely the pair a13bd72 recorded as unable to agree on Azure
    // Files -- inode numbers synthesized, mode fixed, timestamps rewritten by
    // the server on close. A digest agrees on any filesystem, and says more:
    // the same bytes rather than merely the same file.
    unsigned char staged_digest[SHA256_DIGEST_BYTES];
    if (hash_file_at(staging_fd, temporary, expected_bytes, staged_digest) != 0) {
      failed = 1;
      why = "cannot read back the staged artifact object";
    } else if (memcmp(staged_digest, approved, SHA256_DIGEST_BYTES) != 0) {
      failed = 1;
      why = "the staged artifact object changed contents before publication";
      errno = 0;
    }
  }
  if (!failed && publish_no_replace(staging_fd, temporary, parent_fd, leaf) != 0) {
    failed = 1;
    why = "cannot publish the artifact object";
  } else if (!failed) {
    published = 1;
  }
  struct stat published_snapshot;
  if (!failed) {
    unsigned char published_digest[SHA256_DIGEST_BYTES];
    if (hash_file_at(parent_fd, leaf, expected_bytes, published_digest) != 0) {
      failed = 1;
      why = "cannot read back the published artifact object";
    } else if (memcmp(published_digest, approved, SHA256_DIGEST_BYTES) != 0) {
      failed = 1;
      why = "the published artifact object does not match what was written";
      errno = 0;
    } else if (fstatat(parent_fd, leaf, &published_snapshot, AT_SYMLINK_NOFOLLOW) == 0) {
      // Kept only so cleanup can recognise what it is removing on a later
      // failure; it is no longer what identity rests on.
      owned = published_snapshot;
    }
  }
  if (!failed && fsync(parent_fd) != 0) {
    failed = 1;
    why = "cannot sync the artifact parent directory";
  }
  if (!failed) {
    unsigned char synced_digest[SHA256_DIGEST_BYTES];
    if (hash_file_at(parent_fd, leaf, expected_bytes, synced_digest) != 0
        || memcmp(synced_digest, approved, SHA256_DIGEST_BYTES) != 0) {
      failed = 1;
      why = "the published artifact object changed contents after it was synced";
      errno = 0;
    }
  }
  if (failed) {
    int refusal = errno;
    cleanup_owned(published ? parent_fd : staging_fd, published ? leaf : temporary, &owned);
    (void)fsync(parent_fd);
    // Restored, so cleanup's own syscalls cannot overwrite the reason.
    errno = refusal;
    fail(why ? why : "cannot write artifact object");
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
  if (copy_fd(source, STDOUT_FILENO, &copied, NULL) != 0) fail("cannot read artifact object");
  close(source);
  close(parent_fd);
  free(leaf);
}

static int copy_and_echo_bounded(
  int source,
  int destination,
  unsigned long long expected,
  unsigned long long *total,
  sha256_context *written
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
    sha256_add(written, buffer, (size_t)count);
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
  /* Fetching materialises a copy for the caller to verify; the manifest it is
   * checked against lives outside this process, so nothing here has to vouch
   * for the bytes. The digest is computed and discarded to keep one copy
   * routine rather than a second that does not hash. */
  sha256_context unused_digest;
  sha256_begin(&unused_digest);
  int failed = copy_and_echo_bounded(
      source,
      target,
      (unsigned long long)source_details.st_size,
      &copied,
      &unused_digest
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

static int restore_sidecars_absent(int parent_fd, const char *leaf) {
  static const char *suffixes[] = { "-journal", "-wal", "-shm" };
  char name[512];
  for (size_t index = 0; index < sizeof(suffixes) / sizeof(suffixes[0]); ++index) {
    if (snprintf(name, sizeof(name), "%s%s", leaf, suffixes[index]) >= (int)sizeof(name)) {
      errno = ENAMETOOLONG;
      return 0;
    }
    struct stat ignored;
    if (fstatat(parent_fd, name, &ignored, AT_SYMLINK_NOFOLLOW) == 0) {
      errno = EBUSY;
      return 0;
    }
    if (errno != ENOENT) return 0;
  }
  return 1;
}

static void restore_object(
  int parent_fd,
  const char *leaf,
  unsigned long long expected_bytes
) {
  if (!valid_segment(leaf)) {
    errno = EINVAL;
    fail("invalid restore destination leaf");
  }
  struct stat source_before;
  if (fstat(4, &source_before) != 0 || !S_ISREG(source_before.st_mode)
      || source_before.st_size < 0
      || (unsigned long long)source_before.st_size != expected_bytes) {
    errno = EINVAL;
    fail("restore source is not the approved regular file");
  }
  if (!restore_sidecars_absent(parent_fd, leaf)) {
    fprintf(stderr, "RESTORE_DESTINATION_ACTIVE\n");
    exit(4);
  }
  int target = openat(
    parent_fd,
    leaf,
    O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
    0600
  );
  if (target < 0) {
    if (errno == EEXIST) {
      fprintf(stderr, "RESTORE_DESTINATION_EXISTS\n");
      exit(3);
    }
    fail("cannot reserve restore destination");
  }
  struct stat owned;
  memset(&owned, 0, sizeof(owned));
  if (fstat(target, &owned) != 0 || !S_ISREG(owned.st_mode)) {
    cleanup_owned(parent_fd, leaf, &owned);
    fail("cannot identify reserved restore destination");
  }
  if (dprintf(
      6,
      "%llu %llu\n",
      (unsigned long long)owned.st_dev,
      (unsigned long long)owned.st_ino
    ) < 0) {
    close(target);
    cleanup_owned(parent_fd, leaf, &owned);
    fail("cannot report reserved restore destination");
  }
  close(6);
  unsigned char decision = 0;
  int failed = read(5, &decision, 1) != 1 || decision != 'C';
  unsigned long long copied = 0;
  sha256_context restore_digest;
  sha256_begin(&restore_digest);
  if (!failed && (copy_and_echo_bounded(4, target, expected_bytes, &copied, &restore_digest) != 0
      || copied != expected_bytes || fsync(target) != 0)) failed = 1;
  struct stat source_after;
  if (!failed && (fstat(4, &source_after) != 0
      || !same_file_snapshot(&source_before, &source_after))) failed = 1;
  struct stat completed;
  if (!failed && (fstat(target, &completed) != 0
      || !S_ISREG(completed.st_mode)
      || completed.st_dev != owned.st_dev
      || completed.st_ino != owned.st_ino
      || completed.st_size < 0
      || (unsigned long long)completed.st_size != expected_bytes)) failed = 1;
  unsigned char approved[SHA256_DIGEST_BYTES];
  if (!failed) sha256_finish(&restore_digest, approved);
  if (close(target) != 0) failed = 1;
  // Content, for the same reason `put_object` uses it: these compare a path
  // against a descriptor, and on Azure Files those two cannot be made to agree.
  // Restore matters here more than anywhere else -- it is the operation run
  // when a database is already lost, on the mount the backup lives on, so a
  // restore that cannot verify itself there is a recovery story with no ending.
  unsigned char landed[SHA256_DIGEST_BYTES];
  if (!failed && (hash_file_at(parent_fd, leaf, expected_bytes, landed) != 0
      || memcmp(landed, approved, SHA256_DIGEST_BYTES) != 0
      || !restore_sidecars_absent(parent_fd, leaf)
      || fsync(parent_fd) != 0
      || hash_file_at(parent_fd, leaf, expected_bytes, landed) != 0
      || memcmp(landed, approved, SHA256_DIGEST_BYTES) != 0
      || !restore_sidecars_absent(parent_fd, leaf))) failed = 1;
  if (failed) {
    cleanup_owned(parent_fd, leaf, &owned);
    (void)fsync(parent_fd);
    fail("cannot commit restore destination");
  }
}

static void remove_owned_restore(
  int parent_fd,
  const char *leaf,
  unsigned long long expected_dev,
  unsigned long long expected_ino
) {
  if (!valid_segment(leaf)) {
    errno = EINVAL;
    fail("invalid restore destination leaf");
  }
  struct stat owned;
  memset(&owned, 0, sizeof(owned));
  owned.st_dev = (dev_t)expected_dev;
  owned.st_ino = (ino_t)expected_ino;
  cleanup_owned(parent_fd, leaf, &owned);
  if (fsync(parent_fd) != 0) fail("cannot sync restore cleanup");
}

static void remove_owned_restore_work(
  int parent_fd,
  int inherited_work_fd,
  const char *work_leaf,
  unsigned long long work_dev,
  unsigned long long work_ino,
  const char *source_leaf,
  unsigned long long source_dev,
  unsigned long long source_ino
) {
  if (!valid_segment(work_leaf) || !valid_segment(source_leaf)) {
    errno = EINVAL;
    fail("invalid restore work identity");
  }
  int work_fd = inherited_work_fd;
  if (work_fd < 0) {
    work_fd = openat(
      parent_fd,
      work_leaf,
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    if (work_fd < 0) fail("cannot open restore work directory for cleanup");
  }
  struct stat opened_work;
  if (fstat(work_fd, &opened_work) != 0
      || !S_ISDIR(opened_work.st_mode)
      || (unsigned long long)opened_work.st_dev != work_dev
      || (unsigned long long)opened_work.st_ino != work_ino) {
    close(work_fd);
    errno = ESTALE;
    fail("restore work directory changed before cleanup");
  }
  if (source_dev != 0 || source_ino != 0) {
    struct stat owned_source;
    memset(&owned_source, 0, sizeof(owned_source));
    owned_source.st_dev = (dev_t)source_dev;
    owned_source.st_ino = (ino_t)source_ino;
    cleanup_owned(work_fd, source_leaf, &owned_source);
  } else {
    struct stat source;
    if (fstatat(work_fd, source_leaf, &source, AT_SYMLINK_NOFOLLOW) == 0
        && S_ISREG(source.st_mode)) {
      (void)unlinkat(work_fd, source_leaf, 0);
    }
  }
  static const char *suffixes[] = { "-journal", "-wal", "-shm" };
  char sidecar[512];
  for (size_t index = 0; index < sizeof(suffixes) / sizeof(suffixes[0]); ++index) {
    if (snprintf(
        sidecar,
        sizeof(sidecar),
        "%s%s",
        source_leaf,
        suffixes[index]
      ) >= (int)sizeof(sidecar)) continue;
    struct stat details;
    if (fstatat(work_fd, sidecar, &details, AT_SYMLINK_NOFOLLOW) == 0
        && S_ISREG(details.st_mode)) {
      (void)unlinkat(work_fd, sidecar, 0);
    }
  }
  if (fsync(work_fd) != 0) fail("cannot sync restore work cleanup");
  close(work_fd);
  struct stat named_work;
  if (fstatat(parent_fd, work_leaf, &named_work, AT_SYMLINK_NOFOLLOW) != 0
      || !S_ISDIR(named_work.st_mode)
      || (unsigned long long)named_work.st_dev != work_dev
      || (unsigned long long)named_work.st_ino != work_ino
      || unlinkat(parent_fd, work_leaf, AT_REMOVEDIR) != 0
      || fsync(parent_fd) != 0) {
    errno = errno ? errno : ESTALE;
    fail("cannot remove restore work directory");
  }
}

static void create_restore_work(int parent_fd) {
  char name[128];
  for (unsigned int attempt = 0; attempt < 1000; ++attempt) {
    snprintf(
      name,
      sizeof(name),
      ".shapepilot-restore-%ld-%u",
      (long)getpid(),
      attempt
    );
    if (mkdirat(parent_fd, name, 0700) != 0) {
      if (errno == EEXIST) continue;
      fail("cannot create restore work directory");
    }
    int work_fd = openat(
      parent_fd,
      name,
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    );
    struct stat owned;
    if (work_fd < 0 || fstat(work_fd, &owned) != 0 || !S_ISDIR(owned.st_mode)) {
      if (work_fd >= 0) close(work_fd);
      (void)unlinkat(parent_fd, name, AT_REMOVEDIR);
      fail("cannot identify restore work directory");
    }
    if (fsync(parent_fd) != 0
        || dprintf(
          STDOUT_FILENO,
          "%s %llu %llu\n",
          name,
          (unsigned long long)owned.st_dev,
          (unsigned long long)owned.st_ino
        ) < 0) {
      close(work_fd);
      (void)unlinkat(parent_fd, name, AT_REMOVEDIR);
      fail("cannot commit restore work directory");
    }
    close(work_fd);
    return;
  }
  errno = EEXIST;
  fail("cannot reserve restore work directory");
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
  if (strcmp(argv[1], "create-restore-work") == 0 && argc == 3) {
    create_restore_work(root_fd);
    close(root_fd);
    return 0;
  }
  if (strcmp(argv[1], "restore") == 0 && argc == 4) {
    char *end = NULL;
    errno = 0;
    unsigned long long expected = strtoull(argv[3], &end, 10);
    if (errno != 0 || !end || *end != '\0') {
      fprintf(stderr, "invalid restore byte length\n");
      return 2;
    }
    restore_object(root_fd, argv[2], expected);
    close(root_fd);
    return 0;
  }
  if (strcmp(argv[1], "remove-restore") == 0 && argc == 5) {
    char *dev_end = NULL;
    char *ino_end = NULL;
    errno = 0;
    unsigned long long dev = strtoull(argv[3], &dev_end, 10);
    unsigned long long ino = strtoull(argv[4], &ino_end, 10);
    if (errno != 0 || !dev_end || *dev_end != '\0' || !ino_end || *ino_end != '\0') {
      fprintf(stderr, "invalid restore identity\n");
      return 2;
    }
    remove_owned_restore(root_fd, argv[2], dev, ino);
    close(root_fd);
    return 0;
  }
  if (strcmp(argv[1], "remove-restore-work") == 0 && argc == 9) {
    char *ends[4] = { NULL, NULL, NULL, NULL };
    errno = 0;
    unsigned long long work_dev = strtoull(argv[3], &ends[0], 10);
    unsigned long long work_ino = strtoull(argv[4], &ends[1], 10);
    unsigned long long source_dev = strtoull(argv[6], &ends[2], 10);
    unsigned long long source_ino = strtoull(argv[7], &ends[3], 10);
    if (errno != 0 || !ends[0] || *ends[0] != '\0'
        || !ends[1] || *ends[1] != '\0'
        || !ends[2] || *ends[2] != '\0'
        || !ends[3] || *ends[3] != '\0') {
      fprintf(stderr, "invalid restore work identity\n");
      return 2;
    }
    int inherited_work_fd = -1;
    if (strcmp(argv[8], "inherited") == 0) {
      inherited_work_fd = 4;
    } else if (strcmp(argv[8], "open-by-name") != 0) {
      fprintf(stderr, "invalid restore work descriptor mode\n");
      return 2;
    }
    remove_owned_restore_work(
      root_fd,
      inherited_work_fd,
      argv[2],
      work_dev,
      work_ino,
      argv[5],
      source_dev,
      source_ino
    );
    close(root_fd);
    return 0;
  }
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

# Hermetic commands for executing the workflow's production shell without Azure.
az() {
  printf 'az %s\n' "$*" >> "$TRACE"
  case "$1 $2" in
    "acr login") ;;
    "acr show") printf '%s\n' "$ACR_LOGIN_SERVER" ;;
    "acr repository")
      case "$3" in
        list) printf 'true\n' ;;
        show-tags)
          if [[ "$*" == *"@=='latest'"* && -s "$LATEST_FILE" ]]; then
            printf '1\n'
          else
            printf '%s\n' "${FAKE_CANDIDATE_COUNT:-0}"
          fi
          ;;
        show)
          if [[ "$*" == *"--image $IMAGE_REPOSITORY:latest"* ]]; then
            printf '%s\n' "$(<"$LATEST_FILE")"
          else
            printf '%s\n' "$IMAGE_DIGEST"
          fi
          ;;
        untag) : > "$LATEST_FILE" ;;
        *) return 97 ;;
      esac
      ;;
    "webapp stop") printf '%s\n' "${STOP_STATE:-Stopped}" > "$STATE_FILE" ;;
    "webapp start") printf 'Running\n' > "$STATE_FILE" ;;
    "webapp show")
      if [[ "$*" == *"--query state"* ]]; then
        printf '%s\n' "$(<"$STATE_FILE")"
      else
        printf '{}\n'
      fi
      ;;
    "webapp config")
      case "$3" in
        container)
          while [[ "$1" != "--container-image-name" ]]; do shift; done
          printf '%s\n' "$2" > "$CONFIG_FILE"
          ;;
        show) printf 'DOCKER|%s\n' "$(<"$CONFIG_FILE")" ;;
        appsettings) printf '[]\n' ;;
        *) return 97 ;;
      esac
      ;;
    *) printf 'Unexpected Azure command\n' >&2; return 97 ;;
  esac
}

docker() {
  printf 'docker %s\n' "$*" >> "$TRACE"
  case "$1" in
    load|pull) ;;
    tag)
      if [[ "$2" == *@sha256:* ]]; then
        printf '%s\n' "${2##*@}" > "$TAGGED_FILE"
      else
        printf '%s\n' "$IMAGE_DIGEST" > "$TAGGED_FILE"
      fi
      ;;
    push)
      [[ "${FAIL_PUSH:-false}" != "true" ]] || return 73
      if [[ "$2" == "$ACR_LOGIN_SERVER/$IMAGE_REPOSITORY:latest" ]]; then
        printf '%s\n' "$(<"$TAGGED_FILE")" > "$LATEST_FILE"
      fi
      ;;
    image)
      case "$*" in
        *'{{.Id}}'*) printf '%s\n' "${FAKE_IMAGE_ID:-$SMOKE_TESTED_IMAGE_ID}" ;;
        *org.opencontainers.image.revision*) printf '%s\n' "$GITHUB_SHA" ;;
        *org.opencontainers.image.version*) printf '%s\n' "$BUILD_ID" ;;
        *RepoDigests*) printf '["%s"]\n' "$IMAGE_REFERENCE" ;;
        *) return 97 ;;
      esac
      ;;
    *) printf 'Unexpected Docker command\n' >&2; return 97 ;;
  esac
}

curl() {
  printf 'curl %s\n' "$*" >> "$TRACE"
  printf '%s\n' "${WRITER_HTTP_STATUS:-503}"
}

node() {
  printf 'node %s\n' "$*" >> "$TRACE"
  [[ "$1" == "scripts/verify-deployment.mjs" ]] || return 97
  [[ "${FAIL_HEALTH:-false}" != "true" ]] || return 74
}

git() {
  printf 'git %s\n' "$*" >> "$TRACE"
  [[ "$*" == "ls-remote --exit-code origin refs/heads/main" ]] || return 97
  if [[ "${EXPIRE_DURING_LOOKUP:-false}" == "true" ]]; then
    printf '%s\n' "$MUTATION_START_DEADLINE_EPOCH" > "$CLOCK_FILE"
  fi
  printf '%s\trefs/heads/main\n' "${FAKE_HEAD:-$GITHUB_SHA}"
}

date() {
  if [[ -s "$CLOCK_FILE" ]]; then
    printf '%s\n' "$(<"$CLOCK_FILE")"
  else
    command date "$@"
  fi
}

jq() {
  if [[ "$1" != "-n" ]]; then
    while IFS= read -r _line; do :; done
  fi
  printf '{}\n'
}

sha256sum() {
  while IFS= read -r _line; do :; done
  printf '%s  -\n' "${FAKE_FINGERPRINT:-fixture-fingerprint}"
}

sleep() { :; }

timeout() {
  printf 'timeout %s\n' "$*" >> "$TRACE"
  [[ "$1" == "--signal=TERM" && "$2" == "--kill-after=5s" ]] || return 97
  [[ "$3" == "595s" || "$3" == "235s" ]] || return 97
  shift 3
  "$@"
}

export -f az docker curl node git date jq sha256sum sleep timeout

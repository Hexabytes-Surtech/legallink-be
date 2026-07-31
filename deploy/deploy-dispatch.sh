#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy SSH key (see ~/.ssh/authorized_keys
# on the production server: "command=/opt/legallink/deploy-dispatch.sh ... ssh-ed25519 ...").
# The key can ONLY ever run this dispatcher, and this dispatcher can only ever
# run one of the two known deploy scripts — it never executes arbitrary input,
# even if the SSH private key or GitHub secrets were ever leaked.
case "${SSH_ORIGINAL_COMMAND:-}" in
  deploy-be)
    /opt/legallink/deploy-be.sh
    ;;
  deploy-rag)
    /opt/legallink/deploy-rag.sh
    ;;
  *)
    echo "rejected: unrecognized command" >&2
    exit 1
    ;;
esac

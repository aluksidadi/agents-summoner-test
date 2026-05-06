ARG HERMES_GIT_REF=latest
FROM nousresearch/hermes-agent:${HERMES_GIT_REF}

USER root

RUN curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' \
      | bash \
    && apt-get install -y --no-install-recommends infisical jq \
    && rm -rf /var/lib/apt/lists/*

ENV INFISICAL_DISABLE_UPDATE_CHECK=true

COPY entrypoint.sh /usr/local/bin/agent-entrypoint.sh
COPY config.yaml /opt/hermes-defaults/config.yaml
RUN chmod +x /usr/local/bin/agent-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/agent-entrypoint.sh"]
CMD ["gateway", "run"]

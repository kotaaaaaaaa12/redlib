# Use the official prebuilt Redlib image to keep Workers Builds fast.
ARG REDLIB_IMAGE=quay.io/redlib/redlib:latest
FROM ${REDLIB_IMAGE}

EXPOSE 8080
HEALTHCHECK --interval=1m --timeout=5s --start-period=60s \
  CMD wget --spider -q http://127.0.0.1:8080/settings || exit 1

# An explicit IPv4 address makes the service reachable from the Worker.
ENTRYPOINT ["/usr/local/bin/redlib"]
CMD ["--address", "0.0.0.0", "--port", "8080"]

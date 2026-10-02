# Compile the checked-out repository, rather than importing a Redlib binary.
FROM rust:slim-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates git build-essential cmake perl pkg-config libclang-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /redlib
ARG CARGO_BUILD_JOBS=4
ENV CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}

# This Dockerfile requires the repository root as its build context.
# Only application inputs enter the build stage; local secrets stay outside it.
COPY Cargo.toml Cargo.lock build.rs CREDITS ./
COPY src/ ./src/
COPY static/ ./static/
COPY templates/ ./templates/

RUN cargo build --release --locked --bin redlib

# Match the builder's Debian release so the generated executable uses the
# same runtime libraries. The compiler is not included in the runtime image.
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates libgcc-s1 libstdc++6 wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --user-group --no-create-home \
       --home-dir /nonexistent --shell /usr/sbin/nologin redlib

COPY --from=builder /redlib/target/release/redlib /usr/local/bin/redlib

# Verify the executable and its runtime libraries during the image build.
RUN /usr/local/bin/redlib --version

USER redlib

EXPOSE 8080
HEALTHCHECK --interval=1m --timeout=5s --start-period=60s \
  CMD wget --spider -q http://127.0.0.1:8080/settings || exit 1

ENTRYPOINT ["/usr/local/bin/redlib"]
CMD ["--address", "0.0.0.0", "--port", "8080"]

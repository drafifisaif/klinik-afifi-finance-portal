FROM mcr.microsoft.com/playwright:v1.64.1-noble

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

COPY start-login.sh /opt/gloco-login/start-login.sh
COPY login.mjs /opt/gloco-login/login.mjs
RUN chmod 0555 /opt/gloco-login/start-login.sh \
    && chmod 0444 /opt/gloco-login/login.mjs

USER 1001:1001
WORKDIR /home/pwuser

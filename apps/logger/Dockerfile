FROM python:3.12-alpine
WORKDIR /app
COPY apps/logger/main.py .
COPY apps/logger/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 514/udp
CMD ["/entrypoint.sh"]

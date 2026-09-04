FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_APP_COMMIT=docker
ENV VITE_APP_COMMIT=$VITE_APP_COMMIT
RUN npm run build

FROM php:8.3-apache

RUN pecl install apcu \
    && docker-php-ext-enable apcu \
    && docker-php-ext-install pdo_mysql \
    && a2enmod headers rewrite expires

COPY backend/ /var/www/html/backend/
COPY --from=frontend-build /build/frontend/dist/ /var/www/html/
COPY deployment/frontend/ /var/www/html/frontend/
COPY docker/entrypoint.sh /usr/local/bin/aublst-entrypoint
COPY docker/apache-aublst.conf /etc/apache2/conf-available/aublst.conf

RUN chmod +x /usr/local/bin/aublst-entrypoint \
    && a2enconf aublst \
    && chown -R www-data:www-data /var/www/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD php -r "exit(@file_get_contents('http://127.0.0.1/backend/api.php?action=capabilities') === false ? 1 : 0);"

ENTRYPOINT ["aublst-entrypoint"]

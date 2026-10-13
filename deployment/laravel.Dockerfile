FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND=n8n
ENV VITE_BACKEND=$VITE_BACKEND VITE_API_BACKEND=laravel
RUN npm run build

FROM php:8.4-fpm-bookworm AS php
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libonig-dev libicu-dev libzip-dev unzip \
    && docker-php-ext-install -j2 pdo_pgsql mbstring intl bcmath zip opcache \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/she/backend
COPY backend/ ./
COPY database/ /var/www/she/database/
COPY supabase/migrations/ /var/www/she/supabase/migrations/
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader \
    && php -r 'if (!defined("PASSWORD_ARGON2ID")) exit(1);' \
    && chown -R www-data:www-data storage bootstrap/cache
COPY --from=frontend /build/dist /var/www/she/frontend
COPY deployment/php-production.ini /usr/local/etc/php/conf.d/she-production.ini
USER www-data
EXPOSE 9000
CMD ["php-fpm"]

FROM nginx:stable-bookworm AS nginx
COPY deployment/laravel-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /build/dist /var/www/she/frontend
EXPOSE 8080

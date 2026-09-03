#!/bin/sh
set -eu

php /var/www/html/backend/bin/maintenance.php migrate

(
  while true; do
    sleep 300
    php /var/www/html/backend/bin/maintenance.php cleanup || true
  done
) &

exec apache2-foreground

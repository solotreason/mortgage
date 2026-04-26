# Deployment Security Baseline

Use this checklist before public release.

## Required

- Enforce HTTPS redirects at the edge/load balancer.
- Enable HSTS only after HTTPS is stable.
- Disable directory listing.
- Use separate domains for staging and production (for example, `staging.example.com` and `app.example.com`).
- Serve security headers from the host (see `_headers` in repo for a ready policy).

## NGINX Example

```nginx
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    # Directory listing hardening
    autoindex off;

    root /var/www/mortgage;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
}
```

## Apache Example

```apache
Options -Indexes

RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

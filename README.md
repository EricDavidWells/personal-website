### Transfer to HostGator

- build with `ng build`
- copy all files from `./dist/eric-personal-website/browser` to `~/public_html` on hostgator server
- rename `index.csr.html` to `index.html`
- add the following to a `.htcaccess` file
```
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```
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

### Build steps
- install npm
- install nvm
- npm install
- install emscripten
- build wasm

```
cd wasm
mkdir build
cd build
emcmake ..
emmake .
```


TODO:
- write up quickly explainig the metrics, and tools to use
- write up comparing shoulder joint rotation first vs. rotation second
- load urdf button
- if you choose new robot during point cloud generation it freezes
- spherical shoulder, better layout, discussion
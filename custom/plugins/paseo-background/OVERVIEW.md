# Backgrounds for Paseo

Choose one of six bundled landscapes or a direct HTTPS image URL. Tune image strength, interface background opacity, blur, brightness, fit and placement. Preview locally, save to the connected host, or discard your changes.

Open **Backgrounds** in the sidebar or host plugin settings. The Command Center includes **Open background settings** and **Toggle background**. New installs start with the background off.

Supports Paseo desktop and Web clients from **v0.12.0**, with plugins enabled on the connected host. The declared compatibility range is `>=0.12.0`, with no upper version limit. Tested with the unmodified macOS desktop application and Web client; Windows and Linux use the same renderer implementation but have not been tested in this release. Native mobile is outside this plugin's scope.

```sh
paseo plugin add git:MinLeeV5/paseo-background-plugins --ref v0.1.5
```

Saved preferences are shared by clients connected to the same host. Unsaved previews affect only the current window. HTTPS images are loaded by each client; local file upload is not included.

The plugin adapts selected layout surfaces with a browser image layer and scoped CSS. Paseo source files remain untouched. Menus, controls, editors, terminals and embedded websites retain their own backgrounds. This does not make the operating system window transparent. Internal layout changes in future Paseo versions may require an adapter update.

See the [README](README.md) for installation and verification details. Bundled artwork and plugin code are MIT licensed.

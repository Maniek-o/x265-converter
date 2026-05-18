# x265 Converter in Docker / Unraid

This app can run as a web service inside a Docker container. The container starts the Node.js backend on port `3001` and serves the UI from `/`.

## What you need

- Docker enabled on Unraid.
- A source media share mounted into the container, for example `/mnt/user/media`.
- An appdata folder for temporary files, for example `/mnt/user/appdata/x265-converter`.

## Build the image

From the `x265-converter` folder:

```bash
docker build -t x265-converter:latest .
```

## Run it locally

```bash
docker run -d \
  --name x265-converter \
  -p 3001:3001 \
  -e HOST=0.0.0.0 \
  -e PORT=3001 \
  -e PUBLIC_URL=http://localhost:3001 \
  -e AUTO_OPEN_BROWSER=0 \
  -e APP_TMP_DIR=/tmp/x265-converter \
  -v /mnt/user/media:/data \
  -v /mnt/user/appdata/x265-converter/tmp:/tmp/x265-converter \
  --restart unless-stopped \
  x265-converter:latest
```

Open `http://<IP-UNRAID>:3001` in your browser.

## Unraid setup

The easiest GUI path is to import the included Unraid template file and then edit only the host paths and IP.

1. Go to `Docker` in the Unraid UI and choose `Add Container`.
2. Import `x265-converter-unraid.xml` if you want the fields prefilled, or set the same values manually.
3. Set the image to `x265-converter:latest` if you built it locally on the server, or point to your registry tag if you publish it.
4. Map port `3001` from container to host.
5. Set the container variables:
   - `HOST=0.0.0.0`
   - `PORT=3001`
   - `PUBLIC_URL=http://<IP-UNRAID>:3001`
   - `AUTO_OPEN_BROWSER=0`
   - `FILE_OPEN_ENABLED=0`
   - `APP_TMP_DIR=/tmp/x265-converter`
6. Mount your media share, for example:
   - Host path: `/mnt/user/media`
   - Container path: `/data`
7. Mount appdata for temporary files:
   - Host path: `/mnt/user/appdata/x265-converter/tmp`
   - Container path: `/tmp/x265-converter`
8. Start the container and open `http://<IP-UNRAID>:3001`.

## Test flow

1. Put a few video files into the mounted media share.
2. Open the UI and point the input folder to `/data` or a subfolder inside it.
3. Run a small test encode using the app's test clip option first.
4. Check the converted file output next to the source file.

## Notes

- The app uses the system `ffmpeg` and `ffprobe` available in the image.
- The container only runs the web backend; Electron is not started.
- File-open actions are disabled in the container because there is no desktop shell inside Unraid.
- If you want a different temp location, change `APP_TMP_DIR` to another mounted path.
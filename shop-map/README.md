# Aisle — store map and shopping list

Upload a drawing of one store, save product positions on it, and see the products from your shopping list on the map. A list item without a saved position remains in the “Location unknown” section until you select it and click the map. The app does not calculate routes.

## Run locally in Docker

Docker Engine and Docker Compose are the only host tools needed. From this directory:

```sh
docker compose up --build
```

Open <http://localhost:5173>. The first start installs packages inside the image, builds the app, and creates the local database. Product data, the current shopping list, and the uploaded map persist in the project's ignored `.wrangler/state` directory. Docker keeps application packages in a named volume. Stop with `docker compose down`; do not add `-v` if you want to keep the package volume.

The drawing should be a PNG, JPEG, or WebP under 10 MB. Black can represent shelves and white walkways, but this version displays the image without interpreting the colors. Product positions are saved relative to its dimensions. Replacing the map clears positions and keeps product names and the shopping list.

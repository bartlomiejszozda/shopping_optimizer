# Aisle — store map and shopping list

## Save and restore backups

Run these commands from `shop-map` while the app is running:

```sh
docker compose exec app node scripts/backup-store.mjs
docker compose exec app node scripts/restore-store.mjs backups/FOLDER --replace
```

Replace `FOLDER` with a dated backup folder. Restoring replaces every map present in that backup; maps that exist only in the app remain untouched. Save a fresh backup before restoring. The script checks every file checksum before contacting the app. It also accepts older single-map backups. Maps are restored one at a time, so an error partway through can leave some maps restored; the script reports each completed map.

To enable restoring, set `AISLE_RESTORE_TOKEN` to a long random value in the ignored `.dev.vars` file and restart the app. For example, generate a value with `openssl rand -hex 32`. The restore script reads the same file when run from this directory. Without the token, the restore endpoint is disabled. `AISLE_URL` selects another server (default `http://127.0.0.1:5173`). After restoring, reload the browser. Backups remain ignored by Git; keep another copy outside this computer.

Create named maps with **New map → Add map** and switch between them using **Current map**. Each map has its own drawing, products, categories, locations, and shopping list. Your last selection is remembered in this browser; different tabs can work on different maps. Existing data remains under **My store**, without a database migration. Upload a drawing for each store, save product points and category areas on it, and see the products from your shopping list on the map. Click a category to view it, or click its Edit pencil to change its rectangular area. In Edit mode, drag inside the area to move it, drag an edge or corner to resize it, or use “Draw new area” to replace it. Press Enter while the map is focused or click “Save changes” to commit the area and proportional movement of its assigned product pins; Cancel discards the preview. Category areas may overlap. A product appears at its own point when one is set; otherwise it appears within its category’s area. A list item without either remains in “Location unknown.” The app does not calculate routes.

Existing product names, shopping lists, and map images remain intact after the category update. Products saved before categories were added appear as **Uncategorized** until you assign them. Category locations previously saved as points become small areas around those points. Create your own categories in the Categories tab. Deleting a category moves its products to Uncategorized and keeps their individual points.

When adding a product, Jev ranks up to five of your existing categories and shows its probability for each. The best category is selected automatically when it scores above “none”; you can choose another category before saving. A product assigned to a category with a drawn area starts at the area's center; pins must remain inside their assigned areas. Reassigning a product centers it in the new area. Existing pins outside their assigned areas are moved to the nearest point inside when the store is loaded. Products in categories without an area remain unpinned until the area is drawn.

## Run locally in Docker

Docker Engine and Docker Compose are the only host tools needed. From this directory:

```sh
docker compose up --build
```

For AI category suggestions, create a local `.dev.vars` file in this directory containing `OPENROUTER_API_KEY="your-actual-openrouter-key"`, then restart Compose. `OPENROUTER_API_KEY` is the variable name, not the key itself. Keep the key in that file; it is ignored by Git and excluded from the Docker image. Without a key, select a category manually. The key is used only by the server-side suggestion endpoint, which calls OpenRouter's paid `typesafe/jev-1.13` model. Its displayed percentages are the model's probabilities among the saved categories plus a “none” option; they are suggestions, not guarantees. Check OpenRouter for current Jev pricing and make sure the account has credits.

On Linux, Compose mounts the host's trusted CA bundle read-only so the local Cloudflare runtime can verify HTTPS calls to OpenRouter. If your trusted CA bundle is elsewhere, run `HOST_CA_BUNDLE=/absolute/path/to/ca-bundle.pem docker compose up --build`. The file must contain the CA certificate that issued the connection's certificate. TLS verification remains enabled.

Open <http://localhost:5173>. The first start installs packages inside the image, builds the app, and creates the local database. Product data, categories, the current shopping list, and the uploaded map persist in the project's ignored `.wrangler/state` directory. Docker keeps application packages in a named volume. Stop with `docker compose down`; do not add `-v` if you want to keep the package volume.

## Back up your store

While the app is running, use `node scripts/backup-store.mjs` from this directory to export a dated folder under `backups/`. If Node is only available inside Docker, use `docker compose exec app node scripts/backup-store.mjs` instead. Each folder contains `store.json` and the image for the original map, `map-<id>.json` and an image for each additional map, and a checksum manifest for all maps. JSON files include products, categories, shopping lists, locations, and map dimensions. These files live on the host in this project, outside Docker's named volume. Set `AISLE_BACKUP_DIR=/absolute/path` when running the script on the host to write to another disk. The script reads the app and does not alter its data.

The `backups/` folder stays local and is ignored by Git, along with `.dev.vars`, `.wrangler/state`, and the local CA certificate. Keep another copy of important backups outside this computer; a Git commit does not protect these local files against disk loss. For a raw backup while the app is stopped, copy the entire `.wrangler/state` directory, including all SQLite files and R2 data.

The drawing should be a PNG, JPEG, or WebP under 10 MB. Black can represent shelves and white walkways, but this version displays the image without interpreting the colors. Points and areas are saved relative to its dimensions. Replacing a map clears its points and areas while keeping its names, assignments, and shopping list. Other maps are unaffected. Save category and shopping-list edits before switching maps.

## Check multi-map storage

Run `npm run test:maps` with Node 24 to test legacy data, independent maps, image replacement, concurrent uploads, and backups against an in-memory SQLite database. This does not require Docker or modify your store.

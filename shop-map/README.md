# Aisle — store map and shopping list

Upload a drawing of one store, save product points and category areas on it, and see the products from your shopping list on the map. Click a category to view it, or click its Edit pencil to change its rectangular area. In Edit mode, drag inside the area to move it, drag an edge or corner to resize it, or use “Draw new area” to replace it. Press Enter while the map is focused or click “Save changes” to commit the area and proportional movement of its assigned product pins; Cancel discards the preview. Category areas may overlap. A product appears at its own point when one is set; otherwise it appears within its category’s area. A list item without either remains in “Location unknown.” The app does not calculate routes.

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

While the app is running, use `node scripts/backup-store.mjs` from this directory to export a dated folder under `backups/`. If Node is only available inside Docker, use `docker compose exec app node scripts/backup-store.mjs` instead. Each folder contains `store.json` (products, categories, shopping list, locations, and map dimensions), the original map image, and a checksum manifest. These files live on the host in this project, outside Docker's named volume. Set `AISLE_BACKUP_DIR=/absolute/path` when running the script on the host to write to another disk. The script reads the app and does not alter its data.

The `backups/` folder is eligible for Git; `.dev.vars`, `.wrangler/state`, and the local CA certificate are ignored. Review the shopping list before committing or pushing it. No Git remote is configured by default, so a local commit alone does not protect against laptop loss. For a raw backup while the app is stopped, copy the entire `.wrangler/state` directory, including all SQLite files and R2 data.

The drawing should be a PNG, JPEG, or WebP under 10 MB. Black can represent shelves and white walkways, but this version displays the image without interpreting the colors. Points and areas are saved relative to its dimensions. Replacing the map clears both while keeping names, assignments, and the shopping list.

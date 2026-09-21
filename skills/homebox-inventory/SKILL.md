---
name: homebox-inventory
description: Add or update items in Bruce's Homebox home inventory (inventory.brbjr.com) from photos, receipts, or a description — for insurance/loss documentation. Use whenever Bruce shares a photo of something he owns or bought, mentions a new purchase, a serial number, a receipt, or asks what's in his inventory.
---

# Homebox inventory

Homebox is the system of record for everything Bruce owns that matters for an
insurance claim (cars, appliances, electronics, tools, big purchases). It is
reached through the `homebox` MCP server. bbhome is NOT involved.

## When Bruce shares a photo of an item

1. **Read the photo.** Extract everything visible: what it is, brand/manufacturer,
   model number, serial number (look for labels/plates — read them character by
   character and say so if any digit is ambiguous), color, size, condition.
   A receipt photo gives purchase date, price, and store.
2. **Ask only for what you can't see**, in ONE message: purchase price, purchase
   date, store, and which room it lives in — unless he already said. Suggest
   the most likely room/category so he can just say "yes".
3. **Resolve IDs.** Call `locations_list` and `tags_list`. Match the room and
   category by name (case-insensitive, allow synonyms: "garage" = Garage,
   "fridge" → Appliance). If no match, ask before calling `locations_create` /
   `tags_create` — never invent new rooms silently.
4. **Create the item** with `items_create`:
   `name` (short, e.g. "Samsung French-door refrigerator"), `description`
   (what/where/condition, one or two sentences), `manufacturer`, `modelNumber`,
   `parentId` (location UUID), `tagIds` (category UUID[]), `quantity` 1.
5. **Fill the rest** with `items_update` on the returned id: `serialNumber`,
   `purchasePrice` (number), `purchaseDate` (YYYY-MM-DD), `purchaseFrom`,
   `insured: true` for anything over ~$500, `notes` (anything else — warranty
   length, extended warranty, installer), `warrantyExpires` if known.
   **`notes` has a hard, undocumented 1000-character cap** — Homebox rejects
   anything longer with an opaque 500 error (no length in the message), so
   don't find out the limit by trial and error. Count before sending; if the
   full picture won't fit, prioritize ruthlessly rather than truncating
   mid-thought: keep dates, IDs/instrument numbers, dollar amounts, and
   anything flagged as a discrepancy or follow-up; drop restating what's
   already in `description`/other fields; abbreviate freely (org names,
   "recorded"→"rec.", "instrument"→"instr.", etc.) once the important facts
   are locked in. If it still won't fit, say so and ask Bruce what to cut
   rather than silently dropping the tail end.
6. **Attach the photo(s).**
   - **Claude Code, with a real file on disk** (read it, then base64 it —
     never do this for an image merely pasted into a Claude Code chat; it
     must be an actual file path): call `items_attachment_add` with
     `type: "photo"`, `primary: true` for the best overall shot; receipts as
     `type: "receipt"`; manuals as `type: "manual"`.
   - **Every other client — claude.ai web, the mobile app, the Desktop app,
     Cowork** — you were only ever given *vision* over the chat photo, never
     its raw bytes, so there is nothing to upload and no file path to read.
     Do **not** call `items_attachment_add` here; it cannot succeed and will
     just hang or produce garbage. Instead call `items_upload_link` with the
     item's id and give Bruce that URL: tell him to open it and pick/upload
     the photo(s) himself, right from his phone or browser — it accepts
     several files in one go and needs no login (the link itself is
     time-limited and scoped to this one item).
7. **Confirm** in one compact block: name, location, category, serial, price,
   date, insured flag, what was attached (or the upload link, if you couldn't
   attach it yourself), and the item link. Fix anything he corrects with
   `items_update`.

## Updating an existing item

Find it with `items_list` (`q` = free text; add `relatedTagIds` after checking
`tags_list` if the search is broad), confirm the match by name + location, then
`items_update`. Never delete without an explicit "delete" from Bruce.

## Answering questions ("what's the serial on the washer", "what did I pay
for the TV", "what's in the garage")

`items_list` with `q` and/or `parentId`; `items_get` for full detail. Report
purchase price and date when relevant; totals across items are fine to sum.

## Rules

- Currency is USD; dates are America/Chicago.
- One item per physical thing. A washer and dryer are two items.
- Cars: name = "YYYY Make Model", `serialNumber` = VIN, notes = plate, mileage
  at purchase, trim.
- If a serial/model is partially unreadable, store what's certain and put
  "verify: <what's unclear>" in `notes`; tell Bruce.
- Don't call any `*_delete`, `actions_*`, or `users_*` tool unless Bruce
  explicitly asks for that exact operation.

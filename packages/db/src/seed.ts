import { scryptSync, randomBytes } from "node:crypto";
import { transaction, store, config, RESTAURANT } from "./index.js";
import { seedProducts } from "./menu.js";
if (config.SAYGO_DEMO !== "true")
  throw new Error("Fictional seed requires SAYGO_DEMO=true");
try {
  await transaction(async (tx) => {
    if (!(await tx.get("restaurants", RESTAURANT)))
      tx.put("restaurants", {
        id: RESTAURANT,
        name: "Harbor Burger",
        timezone: "America/Los_Angeles",
        instructions:
          "Please pull forward to the next window. Payment is due there.",
        menu_version: 1,
        price_version: 1,
        upsell_enabled: false,
        pos_mode: "accept",
        order_number: 0,
      });
    if (!(await tx.get("lanes", "lane-1")))
      tx.put("lanes", {
        id: "lane-1",
        restaurant_id: RESTAURANT,
        epoch: 0,
        current_session: null,
      });
    for (const data of seedProducts)
      if (!(await tx.get("products", data.id)))
        tx.put("products", { id: data.id, restaurant_id: RESTAURANT, data });
    for (const role of ["admin", "crew", "kitchen"])
      if (!(await tx.get("staff_users", role))) {
        const salt = randomBytes(16).toString("hex");
        tx.put("staff_users", {
          id: role,
          restaurant_id: RESTAURANT,
          role,
          enabled: true,
          password_hash: `${salt}:${scryptSync(config.SAYGO_STAFF_PASSWORD, salt, 64).toString("hex")}`,
        });
      }
  });
  console.log("Harbor Burger DynamoDB seed ready (existing data preserved).");
} finally {
  await store.close();
}

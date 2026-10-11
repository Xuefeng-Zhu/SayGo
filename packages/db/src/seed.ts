import { scryptSync, randomBytes } from "node:crypto";
import { db, pool, schema, config, RESTAURANT } from "./index.js";
import { seedProducts } from "./menu.js";
if (config.SAYGO_DEMO !== "true")
  throw new Error("Fictional seed requires SAYGO_DEMO=true");
try {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.restaurants)
      .values({
        id: RESTAURANT,
        name: "Harbor Burger",
        timezone: "America/Los_Angeles",
        instructions:
          "Please pull forward to the next window. Payment is due there.",
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.lanes)
      .values({ id: "lane-1", restaurantId: RESTAURANT })
      .onConflictDoNothing();
    for (const data of seedProducts)
      await tx
        .insert(schema.products)
        .values({ id: data.id, restaurantId: RESTAURANT, data })
        .onConflictDoNothing();
    for (const role of ["admin", "crew", "kitchen"]) {
      const salt = randomBytes(16).toString("hex");
      const passwordHash = `${salt}:${scryptSync(config.SAYGO_STAFF_PASSWORD, salt, 64).toString("hex")}`;
      await tx
        .insert(schema.staffUsers)
        .values({ id: role, restaurantId: RESTAURANT, role, passwordHash })
        .onConflictDoNothing();
    }
  });
  console.log("Harbor Burger demo seed ready (existing data preserved).");
} finally {
  await pool.end();
}

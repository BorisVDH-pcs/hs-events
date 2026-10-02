-- Undo 20261004140000_admin_swap_tiles.sql: tiles can no longer be dragged
-- between squares. Nothing else used the function, and tiles already moved
-- stay where they were put.
--
-- Run in the Supabase SQL editor. The builder still offers dragging until the
-- commit that added it is reverted; every drop is then refused with "Could not
-- find the function", and nothing changes.

drop function if exists admin_swap_tiles(uuid, int, int, int, int);

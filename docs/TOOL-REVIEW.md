# MCP tool review

All 36 tools published by the plugin remain. Eight definitions behind the unused internal lead role were removed; none appeared in the plugin golden catalog. Catalog wording changed for `ppt_board`, `ppt_time`, `ppt_locks`, `ppt_add_shape`, `ppt_add_image`, `ppt_add_video`, `ppt_set_image`, `ppt_set_media`, `ppt_delete_slide`. The updates clarify host guidance, required lock ownership, dashboard undo, the default speaking budget and workspace media paths. Names and schema constraints are unchanged; media source field descriptions now name the workspace assets folder.

| Retained tool | Evidence and purpose |
| --- | --- |
| `ppt_show` | Reads the model or computes local diagnostics without a provider. |
| `ppt_search` | Reads the model or computes local diagnostics without a provider. |
| `ppt_board` | Reads or writes shared messages without starting a provider. |
| `ppt_lint` | Reads the model or computes local diagnostics without a provider. |
| `ppt_time` | Reads the model or computes local diagnostics without a provider. |
| `ppt_locks` | Coordinates slide ownership across MCP clients; no force override is exposed. |
| `ppt_task_done` | Completes shared unassigned tasks or tasks assigned to this MCP client; another client’s assigned tasks are refused. |
| `ppt_note` | Reads or writes shared messages without starting a provider. |
| `ppt_lock` | Coordinates slide ownership across MCP clients; no force override is exposed. |
| `ppt_unlock` | Coordinates slide ownership across MCP clients; no force override is exposed. |
| `ppt_set_text` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_bullets` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_notes` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_style` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_fill` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_outline` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_corners` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_box` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_add_shape` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_add_image` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_add_video` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_image` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_media` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_animation` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_delete_shape` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_add_slide` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_delete_slide` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_move_slide` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_layout` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_transition` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_add_element` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_delete_element` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_set_presentation_title` | Mutates the shared model through /api/edit with validation, locks, pause and protection checks; rendering is local. |
| `ppt_import` | Confined import of a workspace PPTX into the shared model. |
| `ppt_export` | Writes a new workspace copy without overwriting; independent of the human dashboard download routes. |
| `ppt_renderer` | Reports local rendering prerequisites. |

## Removed definitions

| Definition | Reason |
| --- | --- |
| `ppt_task` | Removed the hidden lead-role dispatcher; it created tasks and started built-in workers. The dashboard creates shared task records. |
| `ppt_task_update` | Removed the hidden lead-role dispatch updater and wakeWorker input. The dashboard updates shared task records. |
| `ppt_tasks` | Removed the unpublished lead-role wrapper; task records remain in the board and ppt tasks CLI. |
| `ppt_loop` | Removed the unpublished lead-role creation wrapper; the dashboard manages recurring check records for external clients. |
| `ppt_loop_ran` | Removed the unpublished lead-role wrapper; external clients can record passes through the CLI. |
| `ppt_pin` | Removed the hidden lead-role human control. Pinning guidance requires the dashboard session. |
| `ppt_agents` | Removed the built-in provider roster; the studio now shows connected editors. |
| `ppt_history` | Removed the unpublished lead-role wrapper; read-only history remains in the dashboard and CLI. |

The provider implementations, provider hooks, automatic task dispatch and recovery, automatic loop runner, presence reaper, spend/profile controls and floating provider composer were removed. Tasks and loops persist as records; external clients decide when to work.

Security pass: all 36 tools carry local-scope annotations. Pinned guidance and other workspace text are quoted data, never represented as binding instructions from the human. Speaker notes have no implicit prohibition. Timing values are default estimates. Import/export errors expose fixed messages; detailed helper failures stay in the local log.

# Distributed Workflow library packages

Exported from Mission Designer's GLOBAL team. The actions run on Mission Broker. How to use them:
[`docs/DISTRIBUTED_WORKFLOW_LIBRARY.md`](../../docs/DISTRIBUTED_WORKFLOW_LIBRARY.md).

| File | Load it into | Contains |
| --- | --- | --- |
| `Distributed Workflow Management(1.0.0).WFenvirX` | **Mission Commander**: a work center's **Load packages…** | The *Distributed Workflow Management* environment with all ten actions |
| `Distributed Workflow Environment Library(1.0.0).WFenvirLibX` | **Mission Designer**: library sidebar, **Environments**, upload icon | The environment library and the action library it uses |
| `Distributed Workflow Action Library(1.0.0).WFactionLibX` | **Mission Designer**: library sidebar, **Actions**, upload icon | The ten actions only |

Setting up another Mission Designer needs only the `.WFenvirLibX`: importing it brings in the action
library too. An import lands in the team you are working in, and a library whose name already exists
there is skipped. To share the libraries with every team as the original ones are, an administrator
moves both to GLOBAL (**Admin → Libraries → Move library**).

To re-export after the library changes in Designer, see the usage comment at the top of
[`../scripts/export-designer-library.mts`](../scripts/export-designer-library.mts).

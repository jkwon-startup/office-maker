---
name: osmu-maker
description: "Create PPTX, XLSX and DOCX together from one canonical source. Ask for a shared brief, each format's purpose and template choice, then coordinate separate editable outputs with checkpointed progress."
---

# 한 번에 만들기

Use the user's language. Read [input guide](../../common/references/input-guide.md), [privacy](../../common/references/privacy.md), [sources](../../common/references/sources.md), and [workflow](../../pipelines/osmu/workflow.md).

실제 파일 생성 전 [첫 실행 준비](../../common/references/first-run.md)를 따른다. 스킬이 설치 위치와 의존성을 확인하고 현재 권한 안에서 준비한다. 사용자에게 캐시 위치나 개발자용 검사 명령을 요구하지 않는다. 이후 명령은 준비 결과의 `root`에서 실행한다.

1. Prefill the shared topic, purpose, reader and source material. Ask for missing values, each format's role and template, and explicit output/work locations. Wait for answers unless optional defaults are explicitly requested. Do not repeat three independent questionnaires.
2. Normalize the verified source to `common/schemas/content.schema.json`. Preserve source IDs, facts, units, dates and uncertainty. Reject conflicting canonical facts before producing documents.
3. Follow the PPT, Excel and Word sibling skills to write purpose-specific plans. PPT tells a presentation story; Excel supports data/action tracking; Word explains the detail. Embed plans in `slides`, `workbook`, `document` for richer output. A supplied slide plan must retain the canonical source list. Propagate references to each format without falsely attributing every claim to every source.
4. Check capabilities with package-root `npm run doctor`. Build a small synthetic sample when using a new tool; do not claim absent dependencies are available. No external model/API account is required by these scripts.
5. Dry-run with `npm run osmu -- --input <content.json> --dry-run`. Review plans and critical values. Honor current file approval requirements before writing. The baseline generator is simple; improve the plans to meet the user's purpose rather than calling the default outline a finished content strategy.
6. Run `npm run osmu -- --input <content.json> --output <destination> --run-dir <checkpoint-dir>`. Formats fail independently. Artifacts are never overwritten. Resume the same input with the same run/output paths; a changed input uses a new run directory. Keep checkpoints private and outside distributable folders.
7. Review each actual file and cross-check facts, numbers, units and sources. Checkpoint COMPLETE means three files were created; it does not mean visual review passed. Preserve per-format WARN/FAIL status and name remaining checks.
8. Deliver available files and concise status. On partial failure, report successful files and the failed format's actionable cause; continue recoverable work. Do not hide failed formats behind a generic success statement.

Use only tools and delegation that the current host/session authorize. The executable pipeline invokes three local renderers; it does not create hidden agents or external messages. Templates and personal aliases use the individual skills' registry and the package alias helper.

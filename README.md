# Office Maker

Codex에서 PPT·엑셀·워드를 각각 만들고, 하나의 자료를 세 형식으로 확장하는 공개용 스킬 묶음입니다. 개인 계정, 브랜드, 고객 자료를 포함하지 않습니다.

**0.1.0 초기 공개 버전**입니다. 로컬 생성·재개·템플릿 선택을 검사했으며, 실제 ChatGPT 대화형 실행과 Microsoft Office 호환성은 추가 검증 대상입니다. [버전 안내](docs/release-notes-0.1.0.md)를 확인하세요.

## 스킬과 호출

| 스킬 | Codex 호출 | 결과 |
| --- | --- | --- |
| PPT 만들기 | `$ppt-maker` | 편집 가능한 `.pptx` |
| 엑셀 만들기 | `$excel-maker` | 표·명시적 수식이 있는 `.xlsx` |
| 보고서 만들기 | `$word-maker` | 선택한 보고서 양식에 맞춘 `.docx` |
| 한 번에 만들기 | `$osmu-maker` | 같은 자료에서 위 세 파일 |

스킬이 인식되는 환경에서 호출하면 필요한 입력 항목과 **실제로 등록된** 템플릿을 물어봅니다. 대화에서 이미 알려 준 값은 다시 묻지 않습니다. 답을 받은 뒤 제작하며, “추천값으로 진행”이라고 명시하면 선택 항목에 기본값을 적용합니다.

ChatGPT의 스킬 지원 환경에서는 스킬 선택 UI 또는 `@` 선택을 이용합니다. Codex용 로컬 Node 스크립트가 일반 ChatGPT 대화에서 자동 실행되지는 않습니다. 파일 실행 도구가 없는 환경에서는 요구사항·제작안을 만들고 실행 가능한 환경으로 이어갑니다. Google 서비스나 특정 유료 API를 요구하지 않습니다.

## 설치와 실행

고객은 [처음 사용하는 안내](docs/quickstart.md)를 따라 전체 묶음을 설치합니다. `plugin.json`과 저장소 마켓플레이스 `.agents/plugins/marketplace.json`을 포함합니다. 한 스킬 폴더만 복사하면 공통 런타임 참조가 끊어집니다. [배포 점검표](docs/release-checklist.md)로 미검증 항목을 확인합니다.

플러그인을 지원하는 Codex CLI에서 설치합니다.

```sh
codex plugin marketplace add https://github.com/jkwon-startup/office-maker --ref v0.1.0
codex plugin add office-maker@office-maker-local
```

설치된 SKILL.md의 위치를 기준으로 본체 루트를 확인하고, **실제로 실행할 복사본**에서 아래 의존성 설치를 진행합니다. 호스트에서 선택 가능한 스킬 이름을 확인한 뒤 호출합니다.

Node.js 20 이상이 필요합니다. 실행 환경에서 사용자가 허용한 위치에 전체 저장소를 받은 다음:

```sh
npm ci --ignore-scripts
npm run doctor
npm test
npm run release:check
npm run osmu -- --input examples/synthetic/input.json --dry-run
npm run osmu -- --input examples/synthetic/input.json --output outputs/demo --run-dir work/demo
```

위 입력은 가상 예시입니다. 실제 업무 파일은 `inputs/`, 중간 파일은 `work/`, 결과는 `outputs/` 또는 사용자가 지정한 외부 위치에 둡니다. 이 세 폴더는 Git 추적 대상에서 제외됩니다. 기존 결과를 덮어쓰지 않습니다.

각 형식의 제작안을 작성한 뒤 독립 실행할 수도 있습니다. 입력 형식은 스킬의 `schemas/`를 따릅니다.

```sh
npm run ppt -- --input inputs/slides.json --output outputs/result.pptx
npm run excel -- --input inputs/workbook.json --output outputs/result.xlsx
npm run word -- --input inputs/document.json --output outputs/result.docx
```

스크립트는 완성된 JSON 제작안을 렌더링합니다. 자료 해석·질문·이야기 구성·문장 작성은 스킬을 실행하는 AI가 담당하며, CLI 자체가 모델을 호출하지는 않습니다.

## 템플릿과 개인 호출 이름

공개 라이브러리의 초기 목록은 모두 비어 있습니다. 사용자가 준 여러 파일은 각기 분석하여 고정 ID(PPT `T001`, 엑셀 `E001`, 워드 `W001`), 중립적 이름, 버전, 디자인 규칙으로 등록합니다. 상세 절차는 [PPT 템플릿 안내](skills/ppt-maker/references/template-library.md)와 [워드 보고서 양식 안내](skills/word-maker/references/document-rules.md)에 있습니다. 자동 원본 분석·등록 CLI는 아직 없으며, 이 절차는 파일 분석 도구를 가진 스킬 실행자가 수행합니다.

워드 양식은 디자인과 함께 `report.sections`에 절 ID·제목·순서·필수 여부·표 머리글을 보존할 수 있습니다. 제작안의 `templateSectionId`로 연결하며 필수 절 누락·중복·미등록 항목·제목이나 표 머리글 불일치는 생성 전에 차단합니다. 등록된 순서로 배치하고 실제 Word 제목 스타일과 표 머리글 반복을 적용합니다. 상세본이 기본이며 요약본은 요청 시 추가합니다.

실제 고객 원본과 개인 라이브러리는 공개 저장소 밖에서 관리합니다. 제작안에서 다음처럼 개인 목록의 절대 경로를 지정할 수 있습니다. 아래 경로는 자리표시자입니다.

```json
{"template":{"id":"T001","version":"1.0.0","library":"<사용자가 지정한 개인 목록의 절대 경로>"}}
```

선택 시 등록된 이름 또는 고정 ID의 숫자 부분을 사용합니다. “1”은 정렬 순서와 관계없이 T001을 뜻합니다. 검토가 끝난 `ready` 버전만 생성기에 전달하고, 수정 시 원래 버전을 유지합니다. 미등록 또는 모호한 이름을 임의로 대체하지 않습니다. 선택을 “추천”으로 한 경우는 `template: "recommended"`로 전달하고 기본 중립 디자인임을 알립니다.

자신만의 명령 이름은 본체에 연결하는 얇은 스킬로 생성합니다. `--dest`는 사용자가 선택한 개인 스킬 상위 폴더이며, 공개 소스 안에는 만들지 않습니다.

```sh
node tools/create-alias.mjs --name my-ppt --input ppt-maker --dest <개인-스킬-폴더> --dry-run
node tools/create-alias.mjs --name my-ppt --input ppt-maker --dest <개인-스킬-폴더>
```

이후 해당 호스트가 새 스킬을 발견하면 Codex에서 `$my-ppt`로 호출합니다. 별칭 생성은 ChatGPT 스킬 설치를 자동화하지 않습니다. 개인 별칭은 설치된 본체 위치를 가리키므로 본체를 이동하면 다시 생성해야 합니다.

## 현재 지원 범위

- PPT: 제목·본문·비교·로드맵·KPI·마무리 레이아웃, 편집 가능한 텍스트·도형, 발표자 노트, 슬라이드별 출처, 선택한 디자인 토큰과 기본 영역 좌표.
- 엑셀: 여러 시트, 표 머리글, 열 폭·숫자 형식, 명시적 수식과 선택적 캐시 값, 필터·고정 행·인쇄 방향.
- 워드: 보고서 양식의 필수 항목·순서·표 머리글 대응, 실제 제목 수준·문단·글머리표·표, 글꼴·크기·색·줄 간격, A4/Letter·가로/세로·여백, 절 앞 페이지 나눔·표 머리글 반복·행 분할 방지.
- OSMU: 공통 자료에서 제작안 생성, 형식별 실행·실패 기록, 동일 입력 체크포인트 재개. 기본 계획은 간단한 시작안이며, 목적에 맞는 상세 제작안은 AI가 작성합니다.

원본 PPTX/XLSX/DOCX의 구조·마스터를 그대로 재사용하는 기능, 자동 폰트 확인, 사진·차트·애니메이션 삽입, 자동 미리보기 렌더링은 아직 구현하지 않았습니다. PPT 계약에는 확장 레이아웃·도형 스타일이 있지만 기본 엔진이 모두 표현하지는 않으며 제한을 결과에 표시합니다. ExcelJS는 수식을 계산하지 않습니다. 캐시 값이 없는 수식의 결과는 Excel 등에서 재계산해야 합니다.

JSON 계약과 핵심 로직 검사는 화면 검토를 대신하지 않습니다. 생성된 파일에는 별도의 렌더링·글꼴·줄바꿈·앱 호환성 검토가 필요하며, 수행하지 않은 검사는 완료로 표시하지 않습니다. 템플릿의 `ready` 표시는 실제 검토 근거가 있어야 하며 상태 문자열만으로 안전성을 입증할 수 없습니다.

## 파일 구조

```text
office-maker/
├── README.md, LICENSE, plugin.json, package.json, package-lock.json, .gitignore
├── skills/
│   ├── ppt-maker/       # SKILL, UI, 템플릿·슬라이드 계약, 생성·검사
│   ├── excel-maker/     # SKILL, UI, 템플릿·통합문서 계약, 생성·검사
│   ├── word-maker/      # SKILL, UI, 템플릿·문서 계약, 생성·검사
│   └── osmu-maker/      # SKILL, UI, 파이프라인 진입점
├── common/
│   ├── references/     # 질문·개인정보·출처 공통 규칙
│   ├── schemas/        # brief, content, report 계약
│   └── runtime/        # 환경 확인, 경로·출력 보호
├── pipelines/osmu/     # 단계 설명과 결과 매핑
├── tools/              # 사용자 별칭 생성
├── docs/               # 고객 설치 안내와 배포 점검표
├── .agents/plugins/    # 공개 마켓플레이스 파일만 포함
├── examples/synthetic/ # 가상 예시만 포함
├── tests/              # 핵심 계약·생성·재개 검사
└── .github/workflows/  # 운영체제별 설치·검사·실제 생성 CI
```

런타임 검증기는 핵심 값·구조·출처·출력 조건을 검사합니다. `schemas/`는 JSON Schema 2020-12 계약이며, 스크립트가 전체 스키마의 모든 키워드를 자동 검증하는 것은 아닙니다. 신규 템플릿 등록 시 전체 스키마 검사와 별도 경로·영역·개인정보 검토를 함께 수행하세요.

배포 전 고객 파일·개인 라이브러리·별칭·환경 파일이 Git에 포함되지 않았는지 확인합니다. 이미 Git에 등록된 파일은 `.gitignore`만으로 제거되지 않습니다. 저작권과 사용 권한을 확인한 자산만 추가합니다.

공식 호스트 안내: [Codex 스킬](https://developers.openai.com/codex/skills/), [ChatGPT 스킬](https://learn.chatgpt.com/docs/build-skills), [플러그인 패키지](https://developers.openai.com/plugins/build/plugins).

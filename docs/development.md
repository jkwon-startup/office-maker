# 개발자 안내

이 문서는 소스 수정·검사·배포를 위한 안내입니다. 첫 사용은 [quickstart](quickstart.md)를 따르세요.

## 소스 실행

전체 묶음의 상대 경로를 유지해야 합니다. 한 스킬 폴더만 복사하면 공통 런타임 참조가 끊어집니다.

```sh
git clone https://github.com/jkwon-startup/office-maker.git
cd office-maker
npm ci --ignore-scripts
npm run doctor
npm test
npm run release:check
npm run osmu -- --input examples/synthetic/input.json --dry-run
npm run osmu -- --input examples/synthetic/input.json --output outputs/demo --run-dir work/demo
```

개별 형식은 `npm run ppt`, `npm run excel`, `npm run word`에 `--input <제작안.json> --output <결과파일>`을 전달합니다. 입력 계약은 각 스킬의 `schemas/`에 있습니다. 스크립트는 모델을 호출하지 않습니다. 자료 해석과 계획은 실행하는 AI나 개발자가 담당합니다.

## 첫 실행 준비 도구

```sh
node common/runtime/setup.mjs --check
node common/runtime/setup.mjs --install
node common/runtime/setup.mjs --install --dest <비공개-실행폴더의-절대-경로>
```

`--check`는 파일을 쓰지 않습니다. READY는 종료 코드 0, NEEDS_SETUP은 2, 오류는 1입니다. `--install`은 잠금 파일을 사용하는 `npm ci --ignore-scripts`를 수행하고 의존성을 다시 확인합니다. Node 미지원·설치 실패·미완료를 READY로 보고하지 않습니다. 설치 로그 뒤에 결과 JSON을 출력합니다.

`--dest`는 새 절대 경로만 허용합니다. 공개 패키지 허용 목록만 복사하고 기존 폴더·공개 소스 폴더는 덮어쓰지 않습니다. 반환된 `root`의 생성기와 공개 템플릿을 사용하세요. 사용자 자료와 개인 라이브러리는 따로 관리합니다. 실제 스킬의 실행 절차는 [first-run](../common/references/first-run.md)에 있습니다.

## 개인 별칭

사용자가 지정한 개인 스킬 상위 폴더에 생성합니다. 먼저 dry-run으로 경로와 내용을 확인합니다.

```sh
node tools/create-alias.mjs --name my-ppt --input ppt-maker --dest <개인-스킬-폴더> --dry-run
node tools/create-alias.mjs --name my-ppt --input ppt-maker --dest <개인-스킬-폴더>
```

## 파일 구조

```text
office-maker/
├── plugin.json, package.json, package-lock.json
├── skills/{ppt-maker,excel-maker,word-maker,osmu-maker}/
│   ├── SKILL.md, agents/openai.yaml
│   └── schemas/, references/, scripts/, assets/templates/  # 형식별 파일
├── common/{references,schemas,runtime}/
├── pipelines/osmu/
├── tools/                       # 별칭·배포 검사
├── examples/synthetic/           # 가상 입력·검토 기록·실제 미리보기
├── docs/, tests/, .github/workflows/
└── .agents/plugins/marketplace.json
```

런타임 검증기는 핵심 구조·출처·값·출력 조건을 검사합니다. JSON Schema 2020-12 계약의 모든 키워드를 자동 검사하는 것은 아닙니다. 새 템플릿은 전체 스키마·영역·경로·개인정보와 실제 렌더링 검토가 필요합니다. ready의 검토 범위를 기록하고 Office 앱별 검증을 일반화하지 마세요.

## 공개 패키지 검사

`inputs/`, `work/`, `outputs/`, `settings/`, `personal-templates/`, `.cache/`, 환경 파일과 개인 설치 설정은 공개 묶음에서 제외합니다. 이미 Git 추적된 파일은 .gitignore만으로 제거되지 않습니다.

`release:check`는 공개 파일 허용 목록, 개인정보 경로·연락처·비밀키 표식, JSON과 스킬 필수 항목을 검사합니다. README 미리보기 PNG 세 개만 개별 허용하며 메타데이터 청크를 차단합니다. 이것은 개인정보를 모두 판별하는 도구가 아니므로 수동 내용·메타데이터·자산 권리 검토를 함께 수행합니다.

CI는 Ubuntu의 Node 20·22, macOS·Windows의 Node 22에서 설치·테스트·가상 파일 생성을 실행합니다. 실제 Microsoft Office의 화면 검토와는 구별됩니다. 상세 항목은 [배포 점검표](release-checklist.md)를 참고하세요.

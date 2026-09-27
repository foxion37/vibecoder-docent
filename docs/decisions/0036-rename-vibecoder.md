# 0036 — 프로젝트 이름을 videcoder에서 vibecoder로 바로잡는다

Date: 2026-09-28
Status: Accepted

## Context

프로젝트 이름이 처음부터 `videcoder-docent`로 잘못 쓰였다. 바이브코더(vibecoder)의 오타다. 폴더·npm 패키지 이름·GitHub 저장소(`foxion37/videcoder-docent`)·설치 URL·서브에이전트 파일 이름까지 같은 오타가 퍼져 있다. npm 레지스트리에는 게시한 적이 없고(`private: true`), 배포는 GitHub Release tgz다(ADR 0007·0027).

후보: A 오타인 채로 둔다 / B 이름을 vibecoder로 통일한다.

## Decision

1. **B. 이름을 `vibecoder-docent`로 통일한다.** npm 패키지 이름, GitHub 저장소 이름(저장소 주인이 웹에서 변경 — 옛 주소는 GitHub가 자동으로 넘겨준다), 로컬 폴더, 서브에이전트 파일 이름(`~/.omp/agent/agents/vibecoder-docent.md`), Release 자산 고정 이름(`vibecoder-docent.tgz`), 문서의 설치 URL.
2. **`docent` 실행 명령과 데이터 폴더(`~/.docent`)는 그대로 둔다.** 사용자가 쓰는 명령과 저장 위치는 바뀌지 않는다.
3. **비공개 보관 저장소 `videcoder-docent-archive` 는 옛 이름 그대로 둔다.** 이미 존재하는 저장소 이름이다.
4. 배포 패키지 이름이 바뀌었으므로 기기 업데이트는 옛 전역 패키지(`videcoder-docent`)를 지우고 새 tgz를 설치한다.

## Consequences

- (+) 이름이 프로젝트 취지(vibecoder)와 일치한다.
- (−) 옛 GitHub 주소를 저장해 둔 곳은 새 주소로 넘겨주기(redirect)에 의존하거나 고쳐야 한다.
- (−) 기기마다 한 번씩 옛 전역 패키지를 지우는 정리가 필요하다.
- 영향 범위: `package.json`, `.github/workflows/release.yml`, `.github/ISSUE_TEMPLATE`, `scripts/install-omp.sh`, `adapters/omp`, `README.md`, `SECURITY.md`, `docs/`

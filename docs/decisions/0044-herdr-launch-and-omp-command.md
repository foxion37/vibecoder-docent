# 0044 — `docent herdr`와 OMP `/docent`로 옆 창에 도슨트를 띄운다

Date: 2026-10-07
Status: Accepted. 사용자 승인. ADR 0007 §5("omp 확장은 `docent` CLI 를 부르는 얇은 껍데기")를 구체화한다.

## Context

Herdr에서 도슨트를 쓰려면 창을 직접 나누고 `docent-tui`를 실행한 뒤 세션을 골라야 했다. 사용자는 OMP 안에서 바로 띄우는 명령을 원했다. OMP는 확장 파일로 슬래시 명령을 등록할 수 있고, Herdr는 `pane split`과 `pane run`을 제공한다.

## Decision

1. `docent herdr [--session <id> | --session-file <경로>] [--cwd <폴더>] [--port N]`이 실제 일을 한다. Herdr 창 안에서만 동작하고, 밖에서는 안내만 하고 종료 코드 2로 끝난다.
2. 순서: 서버가 꺼져 있으면 백그라운드로 켠다(`DOCENT_HOME/server.log`) → 열 세션을 고른다 → 같은 작업 공간에 이미 `docent` 에이전트 창이 있으면 그 창으로 이동한다 → 없으면 지금 창을 오른쪽으로 나누고 `docent-tui --session <id>`를 실행한다.
3. 세션 고르기: 에이전트가 넘긴 세션 파일을 서버의 `GET /api/sessions/resolve?path=`로 도슨트 세션 id로 바꾼다. 아직 비어 있는 새 세션이거나 도슨트가 읽는 폴더 밖이면 404이고, 그때는 작업 폴더가 같은 가장 최근 로컬 세션을 연다. 그것도 없으면 세션 목록부터 보여 준다.
4. `docent-tui --session <id>`는 시작하자마자 그 세션을 연다. 최근 200개 목록 밖이어도 id로 연다.
5. OMP 확장 `adapters/omp/docent-command.ts`는 `/docent`를 등록하고 `docent herdr --cwd <세션 폴더> --session-file <세션 파일>`만 부른다. 결과 문장을 OMP 알림으로 보여 준다. `scripts/install-omp.sh`가 서브에이전트 정의와 함께 확장을 설치한다.
6. Claude Code와 Codex용 슬래시 명령은 만들지 않는다. 셸 명령 `docent herdr`로 충분하다.

## Consequences

- OMP에서 `/docent` 한 번으로 지금 세션을 설명하는 도슨트 창이 옆에 뜨고, 다시 부르면 그 창으로 이동한다.
- 서버를 자동으로 켜므로 처음 쓰는 사람도 따로 `docent --no-open`을 실행하지 않아도 된다. 자동 시작 등록(launchd 등)은 여전히 하지 않는다.
- 새 OMP 세션은 첫 메시지 전에는 파일이 비어 있어서 그 세션 대신 같은 폴더의 최근 세션이 열린다.
- 이미 열린 도슨트 창으로 이동할 때는 그 창의 세션을 바꾸지 않는다.

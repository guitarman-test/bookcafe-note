# 북카페 노트

북카페에서 책을 읽으며 든 감상을 사진과 함께 기록하는 개인 웹사이트. PC와 휴대폰에서 같이 쓴다.

## 구성

- `index.html`: 화면과 스타일
- `app.js`: 동작 코드 (Firebase 연결)
- 호스팅: GitHub Pages (https://guitarman-test.github.io/bookcafe-note/), main 브랜치 루트
- 백엔드: Firebase 무료(Spark) 요금제
  - Authentication: 구글 로그인
  - Firestore(서울 리전)
    - `users/{uid}/visits`: 방문 기록
    - `users/{uid}/photos`: 사진
  - 사진은 Storage를 쓰지 않는다. 브라우저에서 약 200KB 이하 JPEG로 줄인 뒤 base64로 Firestore에 저장한다.
  - 보안 규칙: 로그인한 본인만 `users/{본인uid}/` 아래를 읽고 쓸 수 있다.

## 기록 항목

- 카페 이름, 날짜, 주소
- 항목별 별점: 커피 맛, 내부 분위기, 외관, 조명, 의자 편안함
- 사진 최대 4장
- 좋았던 점 / 아쉬운 점
- 카페 메모
- 읽은 책: 제목, 저자, 책 메모

## 작업 원칙

- 사용자는 코딩을 잘 모른다. 변경 내용은 쉬운 말로 짧게 설명한다.
- 유료 요금제(Blaze)나 Firebase Storage가 필요한 방식은 쓰지 않는다. 꼭 필요하면 먼저 물어본다.
- `firebaseConfig` 값과 Firestore 데이터 구조는 함부로 바꾸지 않는다. 바꿔야 하면 기존 기록이 깨지지 않는 방법을 쓰고, 먼저 알린다.
- 휴대폰 화면에서 쓰기 편한 것을 최우선으로 한다. 사용자의 휴대폰은 삼성(안드로이드)이다.
- 화면 문구는 한국어로 쓴다.
- 커밋과 푸시는 하지 않는다. 사용자가 GitHub Desktop으로 직접 한다.

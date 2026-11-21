export const AGREEMENT_VERSION = "2026-11-21-demographics";
const seoulDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" });

export const entryTerms = [
  ["entryPrivacy", "개인정보 수집·이용 안내", "가입 시 이름, 아이디, 가입 당시의 세는나이와 사용자가 선택한 성별을 계정에 연결합니다. 휴대전화 번호와 생년월일 원문은 입력 화면에서만 확인합니다."],
  ["entryDemo", "시연 계정 이용 안내", "이 계정으로 시연 주문, 찜과 리뷰를 이용할 수 있습니다. 이름과 휴대전화 정보는 직접 입력합니다."],
];

export const finalTerms = [
  ["older", "만 14세 이상입니다.", ""],
  ["service", "서비스 이용약관", "계정으로 메뉴 추천, 찜, 시연 주문 및 리뷰 기능을 이용할 수 있습니다."],
  ["payment", "시연 전자금융거래 안내", "주문은 시연 환경에 접수되며 실제 결제나 배달은 발생하지 않습니다."],
  ["location", "위치기반 서비스 이용 안내", "현재 위치를 요청하면 브라우저 권한을 확인하고, 주소 검색 또는 지도 이동 시 지도·주소 검색 서비스에서 해당 위치를 조회합니다."],
  ["privacy", "개인정보 수집·이용 동의", "이름, 아이디 및 가입 동의 기록은 계정 관리에 사용합니다. 가입 당시의 세는나이와 사용자가 선택한 성별은 이용자 구성 파악에 사용합니다. 비밀번호는 인증 시스템에서 보호하며 저장된 배송 주소와 주문·찜·리뷰는 계정별로 표시됩니다."],
];

export function koreanAgeAtSignup(birth, now = new Date()) {
  if (typeof birth !== "string" || !/^\d{8}$/.test(birth)) return null;
  const yearOfBirth = Number(birth.slice(0, 4));
  const monthOfBirth = Number(birth.slice(4, 6));
  const dayOfBirth = Number(birth.slice(6));
  if (yearOfBirth < 1900) return null;
  const date = new Date(Date.UTC(yearOfBirth, monthOfBirth - 1, dayOfBirth));
  if (date.getUTCMonth() !== monthOfBirth - 1 || date.getUTCDate() !== dayOfBirth) return null;
  const [year, month, day] = seoulDate.format(now).split("-");
  const cutoff = String(Number(year) - 14) + month + day;
  return birth <= cutoff ? Number(year) - yearOfBirth + 1 : null;
}

export function validSignupDemographics(age, gender, now = new Date()) {
  const [year] = seoulDate.format(now).split("-");
  return Number.isInteger(age) && age >= 15 && age <= Number(year) - 1900 + 1 &&
    (gender === "male" || gender === "female" || gender === null);
}

export function signupDetailsError(values, now = new Date()) {
  if (!values.name?.trim() || values.name.trim().length > 30) return "이름을 입력해 주세요.";
  if (!/^01[016789]\d{7,8}$/.test((values.phone || "").replaceAll("-", "").trim())) return "휴대전화 번호를 확인해 주세요.";
  if (koreanAgeAtSignup(values.birth, now) === null) {
    return "만 14세 이상인 생년월일을 숫자 8자리로 입력해 주세요.";
  }
  if (!/^[a-z][a-z0-9_]{3,23}$/i.test((values.identifier || "").trim())) return "아이디는 영문으로 시작하고 영문·숫자·밑줄 4~24자여야 합니다.";
  if (!values.password || values.password.length < 8 || new TextEncoder().encode(values.password).length > 72) return "비밀번호는 8자 이상, 72바이트 이하여야 합니다.";
  if (values.password !== values.passwordConfirm) return "비밀번호 확인이 일치하지 않습니다.";
  return "";
}

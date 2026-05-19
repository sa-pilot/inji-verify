import { claim, LdpVc, VcStatus } from "../types/data-types";
import { EXCLUDE_KEYS_SD_JWT_VC, getVCRenderOrders } from "./config";
import { getLanguageCodes } from "./i18n";

const isSafeKey = (key: string) =>
  key && key !== "__proto__" && key !== "constructor" && key !== "prototype";

type CredentialValue = string | string[] | undefined;

const getValue = (credentialElement: any, currentLanguage: string): CredentialValue => {
  if (credentialElement === null || credentialElement === undefined) {
    return undefined;
  }

  if (typeof credentialElement === "boolean") {
    return credentialElement ? "true" : "false";
  }

  const languageAliases = getLanguageCodes(currentLanguage);
  const fallbackAliases = getLanguageCodes("en");

  if (Array.isArray(credentialElement)) {
    const languageEntry = credentialElement.find(
      (el) =>
        languageAliases.includes(el?.["@language"]) ||
        languageAliases.includes(el?.language)
    );
    if (languageEntry) {
      return languageEntry["@value"] ?? languageEntry.value;
    }

    const fallbackEntry = credentialElement.find(
      (el) =>
        fallbackAliases.includes(el?.["@language"]) ||
        fallbackAliases.includes(el?.language)
    );
    if (fallbackEntry) {
      return fallbackEntry["@value"] ?? fallbackEntry.value;
    }
  }
  if (typeof credentialElement === "object") {
    if ("value" in credentialElement) {
      return getValue(credentialElement.value, currentLanguage);
    }
    let finalValue: string[] = [];
    for (const key of Object.keys(credentialElement)) {
      if (!isSafeKey(key)) continue;
      const nestedValue = getValue(credentialElement[key], currentLanguage);
      if (nestedValue !== undefined) {
        if (Array.isArray(nestedValue)) {
          finalValue.push(...nestedValue);
        } else {
          finalValue.push(nestedValue);
        }
      }
    }
    return finalValue.length > 0 ? finalValue : undefined;
  }

  return String(credentialElement);
};

function createKeyValueEntry(key: string, rawValue: any, currentLanguage: string) {
  if (rawValue === undefined || rawValue === null) return null;

  const value = getValue(rawValue, currentLanguage);

  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }

  return { key, value };
}

function processFields(order: string[], credential: any, currentLanguage: string): { key: string; value: any }[] {
  //  Debug log
  console.log('processFields called with:', { order, credential, credentialType: typeof credential });

  //  Strong null check
  if (!credential) {
    console.error('processFields: credential is null/undefined');
    return [];
  }

  if (typeof credential !== 'object') {
    console.error('processFields: credential is not an object', typeof credential);
    return [];
  }

  if (!Array.isArray(order)) {
    console.error('processFields: order is not an array', order);
    return [];
  }

  return order
    .map((key) => {
      if (!isSafeKey(key)) return null;
      const entry = createKeyValueEntry(key, credential?.[key], currentLanguage);
      if (entry) {
        // Condition check if key is uin/vid then return required key
        if (key === 'UIN' || key === 'VID') {
          return { key: 'V-Credential Number', value: entry.value };
        }
        return entry;
      }
      return null;
    })
    .filter((entry): entry is { key: string; value: any } => entry !== null);
}

function processFarmerLandCredential(credential: any, currentLanguage: string): { key: string; value: any }[] {
  //  Debug log
  console.log('processFarmerLandCredential called with:', { credential, credentialType: typeof credential });

  if (!credential || typeof credential !== 'object') {
    console.error('processFarmerLandCredential: credential is null/undefined');
    return [];
  }

  return getVCRenderOrders().farmerLandCredentialRenderOrder
    .flatMap((keyEntry: any) => {
      if (typeof keyEntry === "string" && isSafeKey(keyEntry)) {
        const value = getValue(credential[keyEntry], currentLanguage);
        if (!value) return null;
        // Condition for uin/vid
        if (keyEntry === 'UIN' || keyEntry === 'VID') {
          return { key: 'V-Credential Number', value };
        }
        return { key: keyEntry, value };
      }

      if (typeof keyEntry === "object" && keyEntry !== null) {
        const [farmKey, farmOrder] = Object.entries(keyEntry)[0];
        if (!isSafeKey(farmKey)) return null;
        const farmObj = credential[farmKey];

        if (!farmObj) return null;

        return (farmOrder as string[])
          .map((farmField) => {
            if (!isSafeKey(farmField)) return null;
            const value = getValue(farmObj[farmField], currentLanguage);
            if (!value) return null;
            // Condition for uin/vid
            if (farmField === 'UIN' || farmField === 'VID') {
              return { key: 'V-Credential Number', value };
            }
            return { key: farmField, value };
          })
          .filter(
            (entry): entry is { key: string; value: any } => entry !== null
          );
      }

      return null;
    })
    .filter((entry: { key: string; value: any }) => entry !== null);
}

export const getDetailsOrder = (vc: any, currentLanguage: string): { key: string; value: any }[] => {
  // debug log
  console.log('getDetailsOrder called with:', { vc, vcType: typeof vc, currentLanguage });

  // Validate and parse VC if it's a string
  let parsedVc = vc;

  if (typeof vc === "string") {
    try {
      parsedVc = JSON.parse(vc);
      console.log('Parsed VC string successfully');
    } catch (e) {
      console.error("Failed to parse VC string:", e);
      return [];
    }
  }

  // Check if VC is null, undefined, or empty
  if (!parsedVc || (typeof parsedVc === "object" && Object.keys(parsedVc).length === 0)) {
    console.error('VC is null, undefined, or empty');
    return [];
  }

  // Ensure parsedVc is a non-null object (not an array)
  if (Array.isArray(parsedVc)) {
    console.error("Invalid VC format: expected an object, got array");
    return [];
  }
  if (typeof parsedVc !== "object" || parsedVc === null) {
    console.error("Invalid VC format: expected an object", typeof parsedVc);
    return [];
  }

  const credential =
    parsedVc?.regularClaims && parsedVc?.disclosedClaims
      ? { ...parsedVc.regularClaims, ...parsedVc.disclosedClaims }
      : parsedVc?.credentialSubject ?? parsedVc;

  console.log('Extracted credential:', credential);

  const type =
    parsedVc?.regularClaims && parsedVc?.disclosedClaims
      ? "SdJwtVC"
      : parsedVc?.type?.find((t: string) => t !== "VerifiableCredential");

  console.log('VC type:', type);

  switch (type) {
    case "InsuranceCredential":
    case "LifeInsuranceCredential":
      return processFields(
        getVCRenderOrders().InsuranceCredentialRenderOrder,
        credential,
        currentLanguage
      );

    case "FarmerCredential":
      return processFields(
        getVCRenderOrders().farmerCredentialRenderOrder,
        credential,
        currentLanguage
      );

    case "MOSIPVerifiableCredential":
    case "MockVerifiableCredential":
      return processFields(
        getVCRenderOrders().MosipVerifiableCredentialRenderOrder,
        credential,
        currentLanguage
      );

    case "IncomeTaxAccountCredential":
      return processFields(
        getVCRenderOrders().IncomeTaxAccountCredentialRenderOrder,
        credential,
        currentLanguage
      );

    case "farmer":
      return processFarmerLandCredential(credential, currentLanguage);

    case "SdJwtVC":
      if (!credential || typeof credential !== 'object') {
        console.error('SdJwtVC: credential is invalid');
        return [];
      }
      return Object.keys(credential)
        .filter(
          (key) =>
            key !== "id" &&
            isSafeKey(key) &&
            credential[key] !== null &&
            credential[key] !== undefined &&
            credential[key] !== "" &&
            !EXCLUDE_KEYS_SD_JWT_VC.includes(key.toLowerCase())
        )
        .map((key) => {
          // Condition for uin/vid
          if (key === 'UIN' || key === 'VID') {
            return {
              key: 'V-Credential Number',
              value: getValue(credential[key], currentLanguage),
            };
          }
          return {
            key,
            value: getValue(credential[key], currentLanguage),
          };
        });

    default:
      if (!credential || typeof credential !== 'object') {
        console.error('Default case: credential is invalid');
        return [];
      }
      // Filter out unwanted keys and parse nested objects
      return Object.keys(credential)
        .filter(
          (key) =>
            key !== "id" &&
            isSafeKey(key) &&
            credential[key] != null &&
            credential[key] !== undefined &&
            credential[key] !== ""
        )
        .map((key) => {
          const entry = createKeyValueEntry(key, credential[key], currentLanguage);
          if (entry) {
            // Condition for uin/vid
            if (key === 'UIN' || key === 'VID') {
              return { key: 'V-Credential Number', value: entry.value };
            }
            return entry;
          }
          return null;
        })
        .filter(
          (entry): entry is { key: string; value: any } => entry !== null,
        );
  }
};

export const calculateVerifiedClaims = (
  selectedClaims: claim[],
  verificationSubmissionResult: { vc: LdpVc | object; vcStatus: VcStatus }[]
) => {
  return verificationSubmissionResult.filter((vc) =>
    selectedClaims.some((claim) => getCredentialType(vc.vc) === claim.type)
  );
};

export const calculateUnverifiedClaims = (
  originalSelectedClaims: claim[],
  verificationSubmissionResult: { vc: LdpVc | object; vcStatus: VcStatus }[]
): claim[] => {
  return originalSelectedClaims.filter((claim) => {
    return !verificationSubmissionResult.some(
      (vcResult) => getCredentialType(vcResult.vc) === claim.type
    );
  });
};

const extractType = (type: any): string | undefined => {
  if (!type) return undefined;
  if (typeof type === "string")
    return type !== "VerifiableCredential" ? type : undefined;
  if (typeof type === "object" && "_value" in type) {
    return type._value !== "VerifiableCredential" ? type._value : undefined;
  }
  return String(type);
};

const findType = (types: any[]): string | undefined =>
  types?.map((type) => extractType(type)).find((t) => t !== undefined);

export const getCredentialType = (credential: any): string => {
  const sdType = credential?.regularClaims?.vct || credential?.regularClaims?.type;

  if (sdType) {
    if (Array.isArray(sdType)) {
      const type = findType(sdType);
      if (type) return type;
    } else {
      const type = extractType(sdType);
      if (type) return type;
    }
  }

  if (Array.isArray(credential?.type)) {
    const type = findType(credential.type);
    if (type) return type;
  }

  return "verifiableCredential";
};

export const getClientId = () => window._env_?.CLIENT_ID;

export const isVPSubmissionSupported = () => {
  const value = window._env_?.VP_SUBMISSION_SUPPORTED;
  return value?.toLowerCase() === "true";
};
import type { AppConfig } from "@agentrade/config";
import {
  apiOperations,
  stripApiVersionPrefix,
  supportedApiVersions,
  type ApiVersion,
  type HttpMethod
} from "@agentrade/contracts";

const apiVersionPrefixPattern = /^\/(v\d+)(?=\/|$)/;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseUrl = (rawUrl: string): URL => new URL(rawUrl, "http://agentrade.local");

const normalizePathPrefix = (value: string | string[] | undefined): string => {
  if (!value) {
    return "";
  }
  const raw = (Array.isArray(value) ? value[0] : value).trim();
  if (raw.length === 0 || raw === "/") {
    return "";
  }
  return `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
};

const templateToMatcher = (pathTemplate: string): RegExp => {
  const segments = stripApiVersionPrefix(pathTemplate).split("/").filter(Boolean);
  if (segments.length === 0) {
    return /^\/?$/;
  }
  const pattern = segments
    .map((segment) =>
      segment.startsWith("{") && segment.endsWith("}") ? "[^/]+" : escapeRegex(segment)
    )
    .join("/");
  return new RegExp(`^/${pattern}/?$`);
};

const methodMatches = (requestMethod: string, operationMethod: HttpMethod): boolean =>
  requestMethod === operationMethod || (requestMethod === "HEAD" && operationMethod === "GET");

const versionlessRouteMatchers = apiOperations.map((operation) => ({
  method: operation.method,
  matcher: templateToMatcher(operation.pathTemplate)
}));

export const assertSupportedApiDefaultVersion = (config: AppConfig): void => {
  if (supportedApiVersions.includes(config.apiDefaultVersion as ApiVersion)) {
    return;
  }
  throw new Error(
    `invalid runtime config: API_DEFAULT_VERSION must be one of ${supportedApiVersions.join(", ")}`
  );
};

export const getRequestPathname = (rawUrl: string): string => parseUrl(rawUrl).pathname;

export const findUnsupportedApiVersion = (rawUrl: string): string | null => {
  const match = getRequestPathname(rawUrl).match(apiVersionPrefixPattern);
  if (!match) {
    return null;
  }
  const requestedVersion = match[1];
  return supportedApiVersions.includes(requestedVersion as ApiVersion) ? null : requestedVersion;
};

export const formatUnsupportedApiVersionMessage = (
  requestedVersion: string,
  defaultVersion: string
): string =>
  `unsupported api version '${requestedVersion}'; supported versions: ${supportedApiVersions.join(", ")}; versionless requests redirect to '${defaultVersion}'`;

export const resolveVersionlessApiRedirect = (input: {
  method: string;
  rawUrl: string;
  defaultVersion: string;
  forwardedPrefix?: string | string[];
}): string | null => {
  const { pathname, search } = parseUrl(input.rawUrl);
  if (pathname.match(apiVersionPrefixPattern)) {
    return null;
  }
  const requestMethod = input.method.toUpperCase();
  const matchedRoute = versionlessRouteMatchers.some(
    (route) => methodMatches(requestMethod, route.method) && route.matcher.test(pathname)
  );
  if (!matchedRoute) {
    return null;
  }
  const prefix = normalizePathPrefix(input.forwardedPrefix);
  const versionedPath =
    pathname === "/" ? `/${input.defaultVersion}` : `/${input.defaultVersion}${pathname}`;
  return `${prefix}${versionedPath}${search}`;
};

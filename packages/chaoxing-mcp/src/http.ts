import type { ChaoxingHttp } from "./list-todos";

export function createFetchChaoxingHttp(): ChaoxingHttp {
  return {
    async request({ url, cookie }) {
      const response = await fetch(url, {
        headers: { cookie },
        redirect: "follow",
      });
      return {
        statusCode: response.status,
        url: response.url,
        body: await response.text(),
      };
    },
  };
}

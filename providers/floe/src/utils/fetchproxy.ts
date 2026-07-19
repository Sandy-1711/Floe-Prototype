export async function fetchProxy(api_key: string, targetUrl: string, targetBody: any, targetMethod: string = "POST") {
    return fetch("https://credit-api.floelabs.xyz/v1/proxy/fetch", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${api_key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
            url: targetUrl,
            method: targetMethod,
            headers: { "Content-Type": "application/json" },
            // Automatically stringify the body if it's passed as an object
            body: typeof targetBody === "string" ? targetBody : JSON.stringify(targetBody),
        }),
    });
}
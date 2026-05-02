// Typed messaging between popup, background, content, and inpage.
export async function rpc(request) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ rpc: 'yacht', request }, (reply) => {
            if (chrome.runtime.lastError)
                return reject(new Error(chrome.runtime.lastError.message));
            if (!reply)
                return reject(new Error('No response from background'));
            if (!reply.ok)
                return reject(new Error(reply.error ?? 'Unknown error'));
            resolve(reply.result);
        });
    });
}

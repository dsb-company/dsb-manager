if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "/service-worker.js"
      );

      console.log(
        "DSB Manager PWA registrado:",
        registration.scope
      );
    } catch (error) {
      console.error(
        "Erro ao registrar Service Worker:",
        error
      );
    }
  });
}
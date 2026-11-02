(() => {
  const $ = (id) => document.getElementById(id);
  const views = ["software", "firmware", "registry"];
  let currentUser = "";
  let toastTimer;

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    if (response.status === 401) {
      showLogin();
      throw new Error("登录状态已失效，请重新登录");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.title || `请求失败 (${response.status})`);
    return body;
  }

  function showLogin() {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    $("registryFrame").removeAttribute("src");
  }

  function showApp(user) {
    currentUser = user || "HS";
    $("accountName").textContent = currentUser;
    $("serverAddress").textContent = location.origin;
    $("loginView").hidden = true;
    $("appView").hidden = false;
    if (!$("registryFrame").getAttribute("src")) $("registryFrame").src = "/api/admin/registry";
    loadReleases();
  }

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("on"), 2400);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function formatSize(bytes) {
    const size = Number(bytes) || 0;
    return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(0)} KB`;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(+date) ? escapeHtml(value) : date.toLocaleString("zh-CN", { hour12: false });
  }

  async function loadReleases() {
    try {
      const manifest = await request("/api/admin/manifest");
      const software = manifest.software || [];
      const firmware = manifest.firmware || [];
      renderRows("software", software);
      renderRows("firmware", firmware);
    } catch (error) {
      toast(error.message);
    }
  }

  function renderRows(kind, rows) {
    const isFirmware = kind === "firmware";
    const list = rows.filter(item => item.fileName);
    $(`${kind}Count`).textContent = `${list.length} 个版本`;
    $(`${kind}Empty`).hidden = list.length > 0;
    $(`${kind}Rows`).innerHTML = list.map(item => {
      const components = item.components || {};
      const componentText = ["CPU01", "CPU02", "FPGA"].filter(key => components[key]).map(key => `${key} ${components[key]}`).join(" · ") || "-";
      return `<tr><td><strong>${escapeHtml(item.version || "-")}</strong></td><td class="file-cell" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</td>${isFirmware ? `<td>${escapeHtml(componentText)}</td>` : `<td>${formatSize(item.fileSize)}</td>`}<td>${formatDate(item.publishedAt)}</td><td class="hash" title="${escapeHtml(item.md5 || "")}">${escapeHtml(item.md5 || "-")}</td><td><button class="delete" data-delete="${escapeHtml(item.fileName)}" data-kind="${kind}">删除</button></td></tr>`;
    }).join("");
  }

  async function publish(form, kind) {
    const button = form.querySelector("button[type=submit]");
    const status = $(`${kind}Status`);
    let uploadId;
    button.disabled = true;
    status.textContent = "正在上传并校验…";
    try {
      const data = new FormData(form);
      const file = data.get("file");
      if (!file || !file.size) throw new Error("请选择 ZIP 文件");
      if (file.size > 2 * 1024 ** 3) throw new Error("文件不能超过 2 GB");
      const fields = Object.fromEntries([...data].filter(([key]) => key !== "file"));
      const started = await request(`/api/admin/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, fileName: file.name, fileSize: file.size }) });
      uploadId = started.uploadId;
      for (let offset = 0, part = 1; offset < file.size; offset += started.chunkSize, part++) {
        await request(`/api/admin/uploads/${uploadId}/parts/${part}`, { method: "PUT", body: file.slice(offset, offset + started.chunkSize) });
        status.textContent = `上传进度 ${Math.min(100, Math.round((offset + started.chunkSize) / file.size * 100))}%`;
      }
      status.textContent = "上传完成，正在校验 MD5…";
      const response = await request(`/api/admin/uploads/${uploadId}/complete`, { method: "POST" });
      uploadId = null;
      status.textContent = `发布成功 · MD5 ${response.md5}`;
      form.reset();
      toast("版本已发布");
      await loadReleases();
    } catch (error) {
      if (uploadId) await request(`/api/admin/uploads/${uploadId}/abort`, { method: "POST" }).catch(() => {});
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("loginError").textContent = "";
    try {
      const result = await request("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("username").value, password: $("password").value })
      });
      showApp(result.username);
    } catch {
      $("loginError").textContent = "账号或密码不正确";
    }
  });

  $("logout").addEventListener("click", async () => {
    await request("/api/admin/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
    const selected = button.dataset.view;
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
    views.forEach(name => $(`${name}View`).hidden = name !== selected);
    if (selected === "registry" && !$("registryFrame").getAttribute("src")) $("registryFrame").src = "/api/admin/registry";
  }));

  $("softwareForm").addEventListener("submit", event => { event.preventDefault(); publish(event.currentTarget, "software"); });
  $("firmwareForm").addEventListener("submit", event => { event.preventDefault(); publish(event.currentTarget, "firmware"); });

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-delete]");
    if (!button) return;
    if (!confirm(`确定删除 ${button.dataset.delete}？`)) return;
    try {
      await request(`/api/admin/${button.dataset.kind}/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" });
      toast("版本已删除");
      await loadReleases();
    } catch (error) {
      toast(error.message);
    }
  });

  $("copyAddress").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.origin);
      toast("上位机地址已复制");
    } catch {
      toast(`上位机服务器地址：${location.origin}`);
    }
  });

  request("/api/admin/session").then(result => showApp(result.username)).catch(showLogin);
})();

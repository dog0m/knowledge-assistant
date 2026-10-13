
    // 浏览器只保存短期访问令牌；所有管理请求都由服务端再次校验权限。
    const state = { token: localStorage.getItem('kb_token'), user: null, sessions: [], currentSession: null };
    const $ = id => document.getElementById(id);
    // 服务端内容一律作为文本转义后再放入 HTML 模板，避免文件名等字段注入脚本。
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    async function api(path, options = {}) {
      const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
      if (state.token) headers.Authorization = `Bearer ${state.token}`;
      const response = await fetch(path, { ...options, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || `请求失败 ${response.status}`);
      return payload;
    }
    function showWorkspace() { $('login').classList.add('hidden'); $('workspace').classList.remove('hidden'); $('userBar').classList.remove('hidden'); $('userName').textContent = `${state.user.display_name}（${state.user.role}）`; $('usersTab').classList.toggle('hidden',state.user.role!=='admin'); $('kbForm').classList.toggle('hidden',state.user.role!=='admin'); $('departmentForm').classList.toggle('hidden',state.user.role!=='admin'); $('exportDocuments').classList.toggle('hidden',!['admin','maintainer','auditor'].includes(state.user.role)); }
    async function login(event) {
      event.preventDefault(); $('loginError').textContent = '';
      try { const data = await api('/api/auth/login', { method:'POST', body:JSON.stringify({ username:$('username').value, password:$('password').value }) }); state.token=data.token; state.user=data.user; localStorage.setItem('kb_token',state.token); showWorkspace(); await loadSessions(); await loadKnowledgeBases(); await loadDocuments(); }
      catch (error) { $('loginError').textContent = error.message; }
    }
    async function loadSessions() { const data=await api('/api/chat/sessions'); state.sessions=data.items; $('sessionSelect').innerHTML=state.sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join(''); if(!state.sessions.length) await newSession(); else { state.currentSession=state.sessions[0].id; await loadMessages(); } }
    async function renameSession() { const title=prompt("请输入新的会话标题"); if(!title||!state.currentSession)return; const data=await api(`/api/chat/sessions/${state.currentSession}`,{method:"PATCH",body:JSON.stringify({title})}); const item=state.sessions.find(s=>s.id===state.currentSession); if(item)item.title=data.title; await loadSessions(); }
    async function deleteSession() { if(!state.currentSession||!confirm("确认删除当前会话？"))return; await api(`/api/chat/sessions/${state.currentSession}`,{method:"DELETE"}); state.currentSession=null; await loadSessions(); }
    async function changePassword() { const current_password=prompt("当前密码"); const new_password=prompt("新密码（至少 10 位）"); if(!current_password||!new_password)return; await api("/api/auth/change-password",{method:"POST",body:JSON.stringify({current_password,new_password})}); localStorage.removeItem("kb_token"); alert("密码已修改，请重新登录"); location.reload(); }
    async function newSession() { const data=await api('/api/chat/sessions',{method:'POST',body:JSON.stringify({title:'新会话'})}); state.sessions.unshift(data); state.currentSession=data.id; $('sessionSelect').innerHTML=state.sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join(''); $('sessionSelect').value=data.id; $('chatMessages').innerHTML=''; }
    async function loadMessages() { state.currentSession=$('sessionSelect').value; const data=await api(`/api/chat/sessions/${state.currentSession}/messages`); $('chatMessages').innerHTML=''; data.items.forEach(renderMessage); }
    function renderMessage(item) { const el=document.createElement('div'); el.className=`message ${item.role}`; el.textContent=item.content; if(item.role==='assistant' && item.sources?.length) { item.sources.forEach(s=>{ const details=document.createElement('details'); details.className='source'; const summary=document.createElement('summary'); summary.textContent=`引用：${s.filename} / ${s.page || '无页码'}`; const snippet=document.createElement('p'); snippet.textContent=s.snippet || ''; details.append(summary,snippet); el.appendChild(details); }); } if(item.role==='assistant' && item.trace_id) { const controls=document.createElement('div'); controls.className='row'; controls.innerHTML=`<select aria-label="回答评分"><option value="5">有帮助</option><option value="4">基本有帮助</option><option value="3">一般</option><option value="2">不太有帮助</option><option value="1">没有帮助</option></select><input maxlength="500" placeholder="反馈意见（可选）"><button class="secondary" data-feedback="${esc(item.trace_id)}">提交反馈</button>`; el.appendChild(controls); } $('chatMessages').appendChild(el); $('chatMessages').scrollTop=$('chatMessages').scrollHeight; }
    async function submitFeedback(button) { const row=button.parentElement; try { await api('/api/feedback',{method:'POST',body:JSON.stringify({session_id:state.currentSession,trace_id:button.dataset.feedback,rating:Number(row.querySelector('select').value),comment:row.querySelector('input').value})}); button.textContent='已提交'; button.disabled=true; } catch(error) { $('chatStatus').textContent=error.message; } }
    async function sendMessage() {
      const content = $('chatInput').value.trim();
      if (!content || !state.currentSession) return;
      $('chatStatus').textContent = '处理中...';
      renderMessage({ role: 'user', content });
      $('chatInput').value = '';
      const answerItem = { role: 'assistant', content: '', sources: [], trace_id: null };
      renderMessage(answerItem);
      const answerElement = $('chatMessages').lastElementChild;
      try {
        const response = await fetch(`/api/chat/sessions/${state.currentSession}/stream?content=${encodeURIComponent(content)}&knowledge_base_id=${encodeURIComponent($("chatKb").value || "")}`, { headers: { Authorization: `Bearer ${state.token}`, Accept: 'text/event-stream' } });
        if (!response.ok) throw new Error(`请求失败 ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const event of events) {
            const dataLine = event.split('\n').find(line => line.startsWith('data: '));
            if (!dataLine) continue;
            const data = JSON.parse(dataLine.slice(6));
            if (event.startsWith('event: meta')) { answerItem.trace_id = data.trace_id; answerItem.sources = data.sources || []; }
            if (event.startsWith('event: token')) { answerItem.content += data.text || ''; answerElement.textContent = answerItem.content; }
          }
        }
        $('chatStatus').textContent = `trace_id: ${answerItem.trace_id || ''}`;
      } catch (error) { answerElement.textContent = error.message; $('chatStatus').textContent = error.message; }
    }    async function loadDocuments() { try { const data=await api('/api/documents'); $('documentRows').innerHTML=data.items.map(d=>`<tr><td>${esc(d.filename)}</td><td>${esc(d.status)}</td><td>${esc(d.version)}</td><td>${esc(d.chunk_count)}</td><td>${esc(d.error_message||'')}</td><td>${d.status==='failed'?`<button data-retry="${esc(d.id)}">重试</button>`:''} ${state.user.role==='admin'||state.user.role==='maintainer'?`<button class="secondary" data-access="${esc(d.id)}">权限</button><button class="secondary" data-delete="${esc(d.id)}">删除</button>`:''}</td></tr>`).join(''); } catch(error) { $('uploadStatus').textContent=error.message; } }
    async function uploadDocuments(event) { event.preventDefault(); const form=new FormData(); [...$('files').files].forEach(file=>form.append('files',file)); form.append('department',$('department').value); form.append('sensitivity',$('sensitivity').value); if($('uploadKb').value) form.append('knowledge_base_id',$('uploadKb').value); $('uploadStatus').textContent='导入中...'; try { const data=await api('/api/documents/batch',{method:'POST',body:form}); $('uploadStatus').textContent=`完成：成功 ${data.succeeded}，失败 ${data.failed}`; await loadDocuments(); } catch(error) { $('uploadStatus').textContent=error.message; } }
    async function manageDocumentAccess(id) {
      const value=prompt("输入允许访问的用户 UUID，多个用逗号分隔；留空表示清空手工 ACL");
      if(value===null)return;
      const allowed_users=value.split(",").map(v=>v.trim()).filter(Boolean);
      await api(`/api/documents/${id}/access`,{method:"PUT",body:JSON.stringify({allowed_users})});
      await loadDocuments();
    }
    async function retryDocument(id) { await api(`/api/documents/${id}/retry`,{method:'POST'}); await loadDocuments(); }
    async function deleteDocument(id) { if(confirm('确认删除这份文档及其索引？')) { await api(`/api/documents/${id}`,{method:'DELETE'}); await loadDocuments(); } }
    async function loadStats() { try { const data=await api('/api/admin/stats'); $('statsContent').innerHTML=`<div class="panel">文档总数：${esc(data.documents.total)}<br>状态：${esc(JSON.stringify(data.documents.by_status))}</div><div class="panel">会话数：${esc(data.sessions.count)}</div><div class="panel">反馈数：${esc(data.feedback.count)}<br>平均评分：${esc(data.feedback.average)}</div>`; } catch(error) { $('statsContent').textContent=error.message; } }
    async function downloadCsv(url,name) { const response=await fetch(url,{headers:{Authorization:`Bearer ${state.token}`}}); if(!response.ok) throw new Error('导出失败'); const blob=await response.blob(); const anchor=document.createElement('a'); anchor.href=URL.createObjectURL(blob); anchor.download=name; anchor.click(); URL.revokeObjectURL(anchor.href); }
    async function loadDepartments() { const data=await api('/api/departments'); const options=data.items.map(d=>`<option value="${esc(d.name)}">${esc(d.name)}</option>`).join(''); ['department','kbDepartment','newDepartment'].forEach(id=>$(id).innerHTML=options); }
    async function loadKnowledgeBases() { const data=await api('/api/knowledge-bases'); $('uploadKb').innerHTML='<option value="">按部门授权</option>'+data.items.map(k=>`<option value="${esc(k.id)}">${esc(k.name)}</option>`).join(''); $('kbRows').innerHTML=data.items.map(k=>`<tr><td>${esc(k.name)}</td><td>${esc(k.department)}</td><td>${esc(k.description)}</td><td>${esc(k.member_count||'')}</td><td>${state.user.role==='admin'?`<button data-members="${esc(k.id)}">管理成员</button>`:''}</td></tr>`).join(''); }
    async function createKnowledgeBase(event) { event.preventDefault(); try { await api('/api/knowledge-bases',{method:'POST',body:JSON.stringify({name:$('kbName').value,department:$('kbDepartment').value,description:$('kbDescription').value})}); $('kbStatus').textContent='知识库已创建'; $('kbForm').reset(); await loadKnowledgeBases(); } catch(error) { $('kbStatus').textContent=error.message; } }
    async function manageMembers(id) { try { const [users,members]=await Promise.all([api('/api/admin/users'),api(`/api/admin/knowledge-bases/${id}/members`)]); const selected=new Set(members.items.map(u=>u.id)); const lines=users.items.filter(u=>u.active).map(u=>`${selected.has(u.id)?'[x]':'[ ]'} ${u.username}（${u.display_name}） UUID=${u.id}`).join('\n'); const input=prompt(`输入要保留的成员用户名，多个用逗号分隔。也支持 UUID；空值表示清空成员。\n\n${lines}`,members.items.map(u=>u.username).join(',')); if(input===null)return; const identifiers=input.split(',').map(v=>v.trim()).filter(Boolean); const resolved=[]; for(const value of identifiers){ const matches=users.items.filter(u=>u.username===value||u.id===value); if(matches.length!==1) throw new Error(`用户“${value}”不存在或用户名不唯一，请使用 UUID`); resolved.push(matches[0].id); } await api(`/api/knowledge-bases/${id}/members`,{method:'PUT',body:JSON.stringify({user_ids:resolved})}); $('kbStatus').textContent='成员权限已更新'; await loadKnowledgeBases(); } catch(error) { $('kbStatus').textContent=error.message; } }
    async function loadUsers() { const data=await api('/api/admin/users'); $('userRows').innerHTML=data.items.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.display_name)}</td><td>${esc(u.role)}</td><td>${esc(u.department)}</td><td>${u.active?'启用':'停用'}</td></tr>`).join(''); }
    async function createUser(event) { event.preventDefault(); try { await api('/api/admin/users',{method:'POST',body:JSON.stringify({username:$('newUsername').value,password:$('newPassword').value,display_name:$('newDisplayName').value,department:$('newDepartment').value,role:$('newRole').value})}); $('userStatus').textContent='用户已创建'; $('userForm').reset(); await loadUsers(); } catch(error) { $('userStatus').textContent=error.message; } }
    async function createDepartment(event) { event.preventDefault(); try { await api('/api/admin/departments',{method:'POST',body:JSON.stringify({name:$('newDepartmentName').value})}); $('departmentStatus').textContent='部门已添加'; $('departmentForm').reset(); await loadDepartments(); } catch(error) { $('departmentStatus').textContent=error.message; } }
    $('loginForm').addEventListener('submit',login); $('renameSession').addEventListener('click',()=>renameSession().catch(e=>$('chatStatus').textContent=e.message)); $('deleteSession').addEventListener('click',()=>deleteSession().catch(e=>$('chatStatus').textContent=e.message)); $('changePassword').addEventListener('click',()=>changePassword().catch(e=>$('chatStatus').textContent=e.message)); $('newSession').addEventListener('click',newSession); $('sessionSelect').addEventListener('change',loadMessages); $('sendMessage').addEventListener('click',sendMessage); $('uploadForm').addEventListener('submit',uploadDocuments); $('kbForm').addEventListener('submit',createKnowledgeBase); $('departmentForm').addEventListener('submit',createDepartment); $('userForm').addEventListener('submit',createUser); $('exportFeedback').addEventListener('click',()=>downloadCsv('/api/admin/feedback/export','feedback.csv').catch(e=>$('chatStatus').textContent=e.message)); $('exportDocuments').addEventListener('click',()=>downloadCsv('/api/documents/export','documents.csv').catch(e=>$('uploadStatus').textContent=e.message)); $('logout').addEventListener('click',()=>{localStorage.removeItem('kb_token');location.reload();}); $('documentRows').addEventListener('click',event=>{const retry=event.target.closest('[data-retry]');const access=event.target.closest('[data-access]');const remove=event.target.closest('[data-delete]');if(retry)retryDocument(retry.dataset.retry);if(access)manageDocumentAccess(access.dataset.access);if(remove)deleteDocument(remove.dataset.delete);}); $('chatMessages').addEventListener('click',event=>{const button=event.target.closest('[data-feedback]');if(button)submitFeedback(button);}); $('kbRows').addEventListener('click',event=>{const button=event.target.closest('[data-members]');if(button)manageMembers(button.dataset.members);}); document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active'));button.classList.add('active');document.querySelectorAll('[id^="tab-"]').forEach(panel=>panel.classList.add('hidden')); $(`tab-${button.dataset.tab}`).classList.remove('hidden'); if(button.dataset.tab==='stats')loadStats(); if(button.dataset.tab==='users')loadUsers();}));
    if(state.token) api('/api/auth/me').then(data=>{state.user=data.user;showWorkspace();return Promise.all([loadSessions(),loadDepartments(),loadKnowledgeBases(),loadDocuments()]);}).catch(()=>localStorage.removeItem('kb_token'));
  







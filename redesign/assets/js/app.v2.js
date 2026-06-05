document.addEventListener('DOMContentLoaded', ()=>{
  // simple nav active state
  const links = document.querySelectorAll('.nav-link');
  function setActive(hash){
    links.forEach(l=>l.classList.toggle('active', l.getAttribute('href')===hash));
  }
  // set on load
  setActive(location.hash || '#inicio');
  // smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', (e)=>{
      const target = document.querySelector(a.getAttribute('href'));
      if(target){
        e.preventDefault();
        target.scrollIntoView({behavior:'smooth',block:'start'});
        history.replaceState(null,'',a.getAttribute('href'));
        setActive(a.getAttribute('href'));
      }
    });
  });

  // legal center compact opener
  const legalOpen = document.getElementById('legalOpen');
  legalOpen?.addEventListener('click',(e)=>{
    e.preventDefault();
    // open centro legal in new tab for the prototype
    window.open('/legal/centro-legal.html','_blank');
  });

  // contact form basic handler
  const form = document.getElementById('contactForm');
  form?.addEventListener('submit',(e)=>{
    e.preventDefault();
    alert('Solicitud enviada — prototipo');
    form.reset();
  });
});
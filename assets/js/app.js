document.addEventListener('DOMContentLoaded', () => {
  const navLinks = Array.from(document.querySelectorAll('.nav-link'));
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const contactForm = document.getElementById('contactForm');
  const whatsappNumber = '573224494595';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = (target) => {
    target?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  // Navegación: mantiene el enlace de la sección visible marcado.
  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      history.replaceState(null, '', href);
      scrollTo(target);
    });
  });

  if ('IntersectionObserver' in window && sections.length) {
    const navObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`);
      });
    }, { rootMargin: '-18% 0px -58% 0px', threshold: [0, 0.15, 0.35, 0.6] });
    sections.forEach((section) => navObserver.observe(section));
  }

  // Animaciones de entrada discretas en todas las secciones. Si no hay soporte,
  // el contenido permanece visible porque motion-ready no se activa.
  const revealItems = Array.from(document.querySelectorAll('.reveal-item'));
  if ('IntersectionObserver' in window && revealItems.length && !reducedMotion) {
    document.body.classList.add('motion-ready');
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -36px 0px' });
    revealItems.forEach((item, index) => {
      item.style.transitionDelay = `${Math.min(index % 4, 3) * 55}ms`;
      revealObserver.observe(item);
    });
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  // Formulario sin backend: prepara la solicitud y la pasa a WhatsApp.
  // No se envían datos a este servidor ni se guardan en el navegador.
  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!contactForm.reportValidity()) return;
      const formData = new FormData(contactForm);
      const name = String(formData.get('name') || '').trim();
      const device = String(formData.get('device') || '').trim();
      const serviceMap = {
        pantalla: 'Cambio de pantalla',
        bateria: 'Revisión o cambio de batería',
        puertos: 'Puertos y conectividad',
        diagnostico: 'Diagnóstico técnico',
        otro: 'Otro servicio'
      };
      const serviceKey = String(formData.get('service') || 'otro');
      const service = serviceMap[serviceKey] || 'Otro servicio';
      const message = String(formData.get('message') || '').trim();
      const lines = [
        'Hola, CamiTec. Quiero consultar por un servicio técnico.',
        `Nombre: ${name}`,
        `Dispositivo: ${device}`,
        `Servicio: ${service}`
      ];
      if (message) lines.push(`Descripción de la falla: ${message}`);
      const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  // Asistente vampirito: mensajes breves según la sección que visita la persona.
  const assistant = document.getElementById('mascot-assistant');
  const bubble = document.getElementById('mascot-bubble');
  const toggle = document.getElementById('mascot-toggle');
  const closeButton = document.getElementById('mascot-close');
  const messageElement = document.getElementById('mascot-message');

  if (assistant && bubble && toggle && closeButton && messageElement) {
    const messages = {
      inicio: '¡Hola! Soy tu vampirito de CamiTec. 🦇 ¿En qué puedo ayudarte hoy?',
      cotizador: '¡Vamos a cotizar! Elige la marca, el modelo y el servicio para consultar un estimado.',
      servicios: '¿Qué le pasa a tu equipo? Explora los servicios y encuentra el que necesitas.',
      reparaciones: 'Te acompañamos en cada etapa: revisión, estimado, reparación y verificación.',
      contacto: '¿Tienes dudas? Escríbenos por WhatsApp. ¡Prometo no morder… casi! 🦇'
    };
    let activeSection = '';

    const setAssistantOpen = (isOpen) => {
      assistant.classList.toggle('is-open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Cerrar mensaje del vampirito' : 'Abrir mensaje del vampirito');
      bubble.setAttribute('aria-hidden', String(!isOpen));
    };

    const setMessage = (sectionId) => {
      if (!messages[sectionId] || sectionId === activeSection) return;
      activeSection = sectionId;
      messageElement.textContent = messages[sectionId];
      if (!reducedMotion) {
        messageElement.classList.remove('message-pop');
        void messageElement.offsetWidth;
        messageElement.classList.add('message-pop');
      }
    };

    toggle.addEventListener('click', () => {
      setAssistantOpen(!assistant.classList.contains('is-open'));
    });
    closeButton.addEventListener('click', () => setAssistantOpen(false));

    // En móvil inicia cerrado para no ocultar campos, botones ni contenido.
    const mobileView = window.matchMedia('(max-width: 700px)');
    if (mobileView.matches) setAssistantOpen(false);
    else setAssistantOpen(assistant.classList.contains('is-open'));

    const updateMascotByScroll = () => {
      const marker = Math.min(window.innerHeight * 0.43, 330);
      let current = sections[0]?.id || 'inicio';
      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        if (rect.top <= marker && rect.bottom > marker) {
          current = section.id;
          break;
        }
        if (rect.top <= marker) current = section.id;
      }
      setMessage(current);
    };

    let scrollPending = false;
    window.addEventListener('scroll', () => {
      if (scrollPending) return;
      scrollPending = true;
      window.requestAnimationFrame(() => {
        updateMascotByScroll();
        scrollPending = false;
      });
    }, { passive: true });
    window.addEventListener('resize', updateMascotByScroll, { passive: true });
    updateMascotByScroll();
  }
});

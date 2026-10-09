document.addEventListener('DOMContentLoaded', () => {
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('main section[id]');
  const ctaQuote = document.getElementById('main-cta');
  const contactSection = document.getElementById('contacto');
  const contactForm = document.getElementById('contactForm');

  if (ctaQuote && contactSection) {
    ctaQuote.addEventListener('click', () => {
      contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      alert('Gracias por tu solicitud. Nos pondremos en contacto contigo pronto.');
      contactForm.reset();
    });
  }

  if ('IntersectionObserver' in window && sections.length && navLinks.length) {
    const observer = new IntersectionObserver((entries) => {
      let visibleId = null;
      entries.forEach((entry) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
          visibleId = entry.target.id;
        }
      });
      if (visibleId) {
        navLinks.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === `#${visibleId}`);
        });
      }
    }, { threshold: [0.35] });

    sections.forEach((section) => observer.observe(section));
  }

  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const targetId = link.getAttribute('href');
      if (targetId && targetId.startsWith('#')) {
        const target = document.querySelector(targetId);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});

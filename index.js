document.addEventListener("DOMContentLoaded", () => {

    const hero   = document.getElementById("hero");
    const hero_btn = document.getElementById("btn-ghost");
    const work   = document.getElementById("work");
    const work_btn = document.getElementById("work-btn-ghost");
    const bg   = document.getElementById("forest");

    hero_btn.addEventListener("click", () => {
        const collapsed = hero.classList.toggle("collapsed");
        const shift = bg.classList.toggle("shift");
        bg.setAttribute("aria-expanded", !shift);
        hero_btn.setAttribute("aria-expanded", !(work.classList.toggle("collapsed")));
        hero_btn.setAttribute("aria-expanded", !collapsed);
        hero_btn.title = "View my projects";
    });
    work_btn.addEventListener("click", () => {
        const collapsed = work.classList.toggle("collapsed");
        const shift = bg.classList.toggle("shift");
        bg.setAttribute("aria-expanded", !shift);
        work_btn.setAttribute("aria-expanded", !(hero.classList.toggle("collapsed")));
        work_btn.setAttribute("aria-expanded", !collapsed);
        work_btn.title = "Back to the top.";
    });
});
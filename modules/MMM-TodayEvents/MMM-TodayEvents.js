/*
 * MMM-TodayEvents
 * Muestra como mensaje los eventos de HOY del módulo calendar.
 * Escucha la notificación CALENDAR_EVENTS que el calendario envía a los demás módulos.
 * Si hoy no hay nada, no muestra nada.
 */
Module.register("MMM-TodayEvents", {
	defaults: {
		title: "Hoy",
		maxItems: 3,
		showTime: true, // muestra la hora en los eventos que no son de todo el día
		classes: "light small normal pre-line",
		updateInterval: 60 * 1000,
		fadeSpeed: 1000
	},

	events: [],

	getScripts () {
		return ["moment.js"];
	},

	start () {
		Log.info(`Starting module: ${this.name}`);
		// Se refresca cada minuto para quitar eventos ya terminados y cambiar de día a medianoche
		setInterval(() => {
			this.updateDom(this.config.fadeSpeed);
		}, this.config.updateInterval);
	},

	notificationReceived (notification, payload) {
		if (notification === "CALENDAR_EVENTS") {
			this.events = Array.isArray(payload) ? payload : [];
			this.updateDom(this.config.fadeSpeed);
		}
	},

	// Eventos que ocurren hoy y que todavía no han terminado
	todayEvents () {
		const now = moment();
		const dayStart = now.clone().startOf("day");
		const dayEnd = now.clone().endOf("day");

		return this.events
			.filter((ev) => {
				const start = moment(Number(ev.startDate));
				const end = moment(Number(ev.endDate));
				if (!start.isValid() || !end.isValid()) return false;
				if (start.isAfter(dayEnd) || !end.isAfter(dayStart)) return false;
				// Los eventos con hora que ya han terminado se descartan
				if (!ev.fullDayEvent && end.isBefore(now)) return false;
				return true;
			})
			.sort((a, b) => {
				// Primero los de todo el día, después por hora
				if (a.fullDayEvent !== b.fullDayEvent) return a.fullDayEvent ? -1 : 1;
				return Number(a.startDate) - Number(b.startDate);
			});
	},

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = this.config.classes;

		const events = this.todayEvents();
		if (events.length === 0) return wrapper;

		const lines = events.slice(0, this.config.maxItems).map((ev) => {
			if (this.config.showTime && !ev.fullDayEvent) {
				return `${moment(Number(ev.startDate)).format("HH:mm")} ${ev.title}`;
			}
			return ev.title;
		});

		const hidden = events.length - lines.length;
		if (hidden > 0) lines.push(`+${hidden} más`);

		wrapper.textContent = lines.length === 1
			? `${this.config.title}: ${lines[0]}`
			: `${this.config.title}\n${lines.join("\n")}`;

		return wrapper;
	}
});
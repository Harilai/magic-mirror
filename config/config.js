/* Config Sample
 *
 * For more information on how you can configure this file
 * see https://docs.magicmirror.builders/configuration/introduction.html
 * and https://docs.magicmirror.builders/modules/configuration.html
 *
 * You can use environment variables using a `config.js.template` file instead of `config.js`
 * which will be converted to `config.js` while starting. For more information
 * see https://docs.magicmirror.builders/configuration/introduction.html#enviromnent-variables
 */
const config = {
	address: "localhost",	// Address to listen on, can be:
							// - "localhost", "127.0.0.1", "::1" to listen on loopback interface
							// - another specific IPv4/6 to listen on a specific interface
							// - "0.0.0.0", "::" to listen on any interface
							// Default, when address config is left out or empty, is "localhost"
	port: 8080,
	basePath: "/",	// The URL path where MagicMirror² is hosted. If you are using a Reverse proxy
									// you must set the sub path here. basePath must end with a /
	ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"],	// Set [] to allow all IP addresses
									// or add a specific IPv4 of 192.168.1.5 :
									// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.1.5"],
									// or IPv4 range of 192.168.3.0 --> 192.168.3.15 use CIDR format :
									// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.3.0/28"],
	trustedProxies: [],	// Reverse proxy address(es) allowed to provide client IPs via X-Forwarded-For.
											// Leave empty (default) if MagicMirror is not behind a reverse proxy.

	useHttps: false,			// Support HTTPS or not, default "false" will use HTTP
	httpsPrivateKey: "",	// HTTPS private key path, only require when useHttps is true
	httpsCertificate: "",	// HTTPS Certificate path, only require when useHttps is true

	language: "es",
	locale: "es-ES",   // this variable is provided as a consistent location
			   // it is currently only used by 3rd party modules. no MagicMirror code uses this value
			   // as we have no usage, we  have no constraints on what this field holds
			   // see https://en.wikipedia.org/wiki/Locale_(computer_software) for the possibilities

	logLevel: ["INFO", "LOG", "WARN", "ERROR"], // Add "DEBUG" for even more logging
	timeFormat: 24,
	units: "metric",

	modules: [
		{
			module: "MMM-MagicMover",
			config: {
				updateInterval: 10 * 60 * 1000,
				ignoredRegions: [],
				maxMove: 15,
				moveWholescreen: false,
			}
		},
		{
			module: "MMM-TodayEvents",
			position: "lower_fourth",
			config: {
				title: "Hoy",    // texto que va delante
				maxItems: 3,     // cuántos eventos como máximo
				showTime: true   // hora en los eventos que no son de todo el día
			}
		},
		{
			module: "MMM-Spotify",
			position: "bottom_right",
			config: {
				debug: true,
				style: "mini",
				showVolumeLabel: false
			}
		},
		{
			module: "alert",
		},
		{
			module: "updatenotification",
			position: "top_bar"
		},
		{
			module: "clock",
			position: "top_left",
			config: {
				displaySeconds: false
			}
		},
		{
			module: "calendar",
			header: "Fechas Importantes",
			position: "top_left",
			config: {
				displaySymbol: false,
				timeFormat: "absolute",
				dateFormat: "D MMM",
				fade: false,
				maximumEntries: 5,
				calendars: [
					{
						fetchInterval: 7 * 24 * 60 * 60 * 1000,
						symbol: "calendar-check",
						url: "https://calendar.google.com/calendar/ical/danitejeroperedo13%40gmail.com/public/basic.ics"
					},
					{
						fetchInterval: 7 * 24 * 60 * 60 * 1000,
						symbol: "calendar-check",
						url: "http://localhost:8080/defaultmodules/calendar/ics/cumpleanos.ics",
						repeatingCountTitle: " años"
					}
				]
			}
		},
		{
			module: "compliments",
			position: "bottom_bar"
		},
		{
			module: "weather",
			position: "top_right",
			config: {
				showFeelsLike: true,
				showWind: true,
				showSun: true,
				roundTemp: true,
				weatherProvider: "openmeteo",
				type: "current",
				lat: 43.4184077,
				lon: -3.8402247
			}
		},
		{
			module: "weather",
			position: "top_right",
			config: {
				weatherProvider: "openmeteo",
				type: "forecast",
				lat: 43.4184077,
				lon: -3.8402247,
				maxNumberOfDays: 5,
				fade: false,
				colored: false,
				roundTemp: true
			}
		},
		// {
		// 	module: "newsfeed",
		// 	position: "bottom_bar",
		// 	config: {
		// 		feeds: [
		// 			{
		// 				title: "New York Times",
		// 				url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
		// 			}
		// 		],
		// 		showSourceTitle: true,
		// 		showPublishDate: true,
		// 		broadcastNewsFeeds: true,
		// 		broadcastNewsUpdates: true
		// 	}
		// },
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") { module.exports = config; }

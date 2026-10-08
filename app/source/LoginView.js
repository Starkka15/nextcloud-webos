/* Server address and sign-in. Shown when there is no stored account. */
enyo.kind({
	name: "NC.LoginView",
	kind: enyo.VFlexBox,
	className: "nc-view",
	events: {
		onSignedIn: ""
	},
	components: [
		{kind: "Scroller", flex: 1, components: [
			{className: "nc-login-box", components: [
				{content: "Nextcloud", className: "nc-brand"},
				{kind: "RowGroup", caption: "Server", components: [
					{name: "url", kind: "Input", hint: "Server address, e.g. cloud.example.com", inputType: "url",
						autoCapitalize: "lowercase", autocorrect: false, spellcheck: false}
				]},
				{kind: "RowGroup", caption: "Account", components: [
					{name: "user", kind: "Input", hint: "User name",
						autoCapitalize: "lowercase", autocorrect: false, spellcheck: false},
					{name: "password", kind: "PasswordInput", hint: "Password or app password"}
				]},
				{name: "button", kind: "Button", caption: "Sign In", className: "enyo-button-affirmative",
					onclick: "signIn"},
				{name: "message", className: "nc-message"},
				{className: "nc-login-note", content: "If your account uses two-step sign-in, create an app " +
					"password on the server under Settings, Security, and enter it here."}
			]}
		]}
	],

	create: function() {
		this.inherited(arguments);
		this.$.url.setValue(NC.api.baseUrl || "");
		this.$.user.setValue(NC.api.user || "");
	},

	signIn: function() {
		var url = this.$.url.getValue();
		var user = this.$.user.getValue();
		var password = this.$.password.getValue();
		if (!url || !user || !password) {
			this.$.message.setContent("Enter the server address, your user name and your password.");
			return;
		}
		this.$.button.setDisabled(true);
		this.$.message.setContent("Signing in…");
		NC.api.signIn(url, user, password, enyo.bind(this, function(ok, message) {
			this.$.button.setDisabled(false);
			if (ok) {
				this.$.password.setValue("");
				this.$.message.setContent("");
				this.doSignedIn();
			} else {
				this.$.message.setContent(String(message));
			}
		}));
	}
});

# BookWriter cloud sign-in: app registration guide

This guide follows the ASD-STE100 specification (Simplified Technical English) as far as possible. It is in English on purpose. The BookWriter screens are in Italian. The Italian names of buttons and fields appear in quotation marks.

Last check of the console names: November 2026 (sections 4 to 6). The Google and Microsoft consoles change often. If a name is different, use the nearest name and the same value.

## 1 Purpose

This guide tells you how to make two sign-in apps. One app is for Google Drive. One app is for Microsoft OneDrive.

After you finish, BookWriter can store these items in your own cloud account:

- The AI settings: endpoints, models, routes, and prices.
- The credentials: the GitHub token and the AI API keys.
- The list of your books, with the status of each book.

BookWriter never stores the text of a book in the cloud. The text of a book goes to GitHub only.

Each sign-in app can see one private folder only. Google calls it `appDataFolder`. Microsoft calls it `approot`. The apps cannot see your other files.

You need one of the two apps. You can make both.

## 2 The values

Table 1 shows all the values that this guide uses. Use the values exactly as written.

Table 1: Values for the two apps

| Item | Google | Microsoft |
| --- | --- | --- |
| Public address of the site | `https://ghostwriting.ws` | `https://ghostwriting.ws` |
| Address for tests on your computer | `http://localhost:5173` | `http://localhost:5173` |
| Name of the app | BookWriter | BookWriter |
| Application type | Web application | Single-page application (SPA) |
| Redirect address | None. Leave the field empty. | `https://ghostwriting.ws/oauth/microsoft.html` and `http://localhost:5173/oauth/microsoft.html` |
| Permissions | `openid`, `email`, `profile`, `drive.appdata` | `Files.ReadWrite.AppFolder`, `offline_access`, `openid`, `profile`, `email` |
| What you copy | Client ID | Application (client) ID |
| Client secret | Do not use. | Do not create. |
| Name of the repository variable | `GOOGLE_CLIENT_ID` | `MICROSOFT_CLIENT_ID` |

The full names of the Google permissions are:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/drive.appdata`

NOTE: A client ID is a public value. It is not a secret. Anyone can see it in the sign-in address.

CAUTION: Do not make a client secret for these apps. BookWriter has no server. A client secret in a web page is not secret.

## 3 Before you start

Make sure that you have these items:

1. A Google account, for the Google app.
2. A Microsoft account, for the Microsoft app. Use the same kind of account that you will use to sign in.
3. Write access to the GitHub repository of BookWriter.
4. A browser that allows pop-up windows for `https://ghostwriting.ws`.

## 4 Task 1: Make the Google app

### 4.1 Make a project

1. Open `https://console.cloud.google.com`.
2. Sign in with your Google account.
3. Click the project picker at the top of the page.
4. Click "New project".
5. In the field "Project name", enter `BookWriter`.
6. Click "Create".
7. Wait until the console shows the new project. Select the project.

### 4.2 Turn on the Google Drive API

1. Open the menu. Click "APIs & Services", then "Library".
2. Search for `Google Drive API`.
3. Click "Google Drive API".
4. Click "Enable".

NOTE: Do this task before you add the scopes. The scope list shows the scopes of the enabled APIs only.

### 4.3 Set up the consent screen

1. Open the menu. Click "Google Auth platform".
2. If the console shows "Google Auth platform not configured yet", click "Get Started".
3. In "App name", enter `BookWriter`.
4. In "User support email", select your email address. Click "Next".
5. For "Audience", select "External". Click "Next".
6. In "Email address", enter your email address. Click "Next".
7. Select "I agree to the Google API Services: User Data Policy". Click "Continue". Click "Create".

NOTE: Some pages of the console use other names for the same fields. The names can be "Application name" and "Support email".

### 4.4 Add the scopes

1. In the left menu, click "Data Access".
2. Click "Add or Remove Scopes".
3. Select `openid`.
4. Select `.../auth/userinfo.email`.
5. Select `.../auth/userinfo.profile`.
6. Select `.../auth/drive.appdata`. The description is "See, create, and delete its own configuration data in your Google Drive".
7. Click "Update".
8. Click "Save".

NOTE: Google lists `drive.appdata` as a non-sensitive scope. A non-sensitive scope does not need a Google security review.

CAUTION: Do not add the scope `drive` or `drive.file`. BookWriter does not need them. These scopes give access to more of your files.

### 4.5 Set the publishing status

1. In the left menu, click "Audience".
2. Find "Publishing status".
3. Do one of the two options in Table 2.

Table 2: Publishing status

| Option | Steps | Result |
| --- | --- | --- |
| Recommended | Click "Publish app". Click "Confirm". | Any Google account can sign in. The consent does not expire. |
| Test mode | Keep "Testing". Click "Add users" in "Test users". Enter your email. Click "Save". | Only the test users can sign in. The consent expires after 7 days. |

NOTE: In test mode, Google shows a warning before the first sign-in. The maximum number of test users is 100.

NOTE: With the recommended option, the Google consent screen can show "Google has not verified this app". Click "Advanced", then continue. You do not have to start the verification for the one scope `drive.appdata`.

### 4.6 Make the OAuth client

1. In the left menu, click "Clients".
2. Click "Create Client".
3. For "Application type", select "Web application".
4. In "Name", enter `BookWriter web`.
5. In "Authorized JavaScript origins", click "Add URI".
6. Enter `https://ghostwriting.ws`.
7. Click "Add URI" again. Enter `http://localhost:5173`.
8. Click "Add URI" again. Enter `http://localhost`.
9. Do not add an "Authorized redirect URI". Leave the section empty.
10. Click "Create".

NOTE: Step 8 is necessary for tests on your computer only. Skip steps 7 and 8 if you do not run BookWriter on your computer.

### 4.7 Copy the Client ID

1. In the dialog box that opens, find "Client ID".
2. Copy the value. It looks like `123456789012-abcdef0123456789.apps.googleusercontent.com`.
3. Keep the value. You use it in section 6.
4. Do not copy or keep a client secret. BookWriter does not use it.

## 5 Task 2: Make the Microsoft app

### 5.1 Register the app

1. Open `https://entra.microsoft.com`.
2. Sign in with your Microsoft account.
3. Click "Entra ID", then "App registrations".
4. Click "New registration".
5. In "Name", enter `BookWriter`.
6. For "Supported account types", select "Any Entra ID Tenant + Personal Microsoft accounts".
7. Click "Register".

CAUTION: The name of the app sets the name of the OneDrive folder. The folder is `Apps/BookWriter`. Microsoft makes the folder the first time that BookWriter signs in. A new name later does not rename the folder.

NOTE: Older pages show the same option as "Accounts in any organizational directory (Any Microsoft Entra directory - Multitenant) and personal Microsoft accounts (such as Skype, Xbox)". The value in the manifest is `AzureADandPersonalMicrosoftAccount`.

NOTE: This option lets BookWriter use `common` as the tenant. If you use personal accounts only, you can select "Personal accounts only". Then set the tenant to `consumers` in section 6.

### 5.2 Add the redirect addresses

1. Open the new app registration.
2. In the left menu, click "Manage", then "Authentication".
3. Click the tab "Redirect URI configuration".
4. Click "Add Redirect URI".
5. In the pane "Select a platform to add redirect URI", select "Single-page application".
6. In "Redirect URI", enter `https://ghostwriting.ws/oauth/microsoft.html`.
7. Click "Configure".
8. Click "Add Redirect URI" again. Select "Single-page application".
9. Enter `http://localhost:5173/oauth/microsoft.html`. Click "Configure".

CAUTION: The platform must be "Single-page application". If you select "Web", the sign-in fails. The token request is then blocked by the browser.

CAUTION: Do not select the options for "Implicit grant". BookWriter does not use them.

NOTE: Step 8 and step 9 are necessary for tests on your computer only.

### 5.3 Add the permissions

1. In the left menu, click "Manage", then "API permissions".
2. Click "Add a permission".
3. Click "Microsoft Graph".
4. Click "Delegated permissions".
5. Select `Files.ReadWrite.AppFolder`. The description is "Have full access to the application's folder (preview)".
6. Select `offline_access`, `openid`, `profile`, and `email`.
7. Click "Add permissions".
8. If the list shows `User.Read`, you can remove it. BookWriter does not use it.

NOTE: The permission `Files.ReadWrite.AppFolder` does not need administrator consent.

CAUTION: Do not add `Files.ReadWrite` or `Files.ReadWrite.All`. These permissions give access to all your OneDrive files.

### 5.4 Copy the Application (client) ID

1. In the left menu, click "Overview".
2. Find "Application (client) ID".
3. Copy the value. It has the form `00000000-0000-0000-0000-000000000000`.
4. Keep the value. You use it in section 6.

NOTE: You do not need the "Directory (tenant) ID" when the tenant is `common`.

### 5.5 Make sure that there is no secret

1. In the left menu, click "Manage", then "Certificates & secrets".
2. Make sure that the list of client secrets is empty.
3. Do not add a client secret or a certificate.

## 6 Task 3: Give the values to BookWriter

Do option A for the public site. Do option B for one device only.

### 6.1 Option A: the public site

1. Open the GitHub repository of BookWriter.
2. Click "Settings".
3. In the left menu, click "Security", then "Secrets and variables", then "Actions".
4. Click the tab "Variables".
5. Click "New repository variable".
6. In "Name", enter `GOOGLE_CLIENT_ID`. In "Value", enter the Google Client ID. Click "Add variable".
7. Click "New repository variable" again.
8. In "Name", enter `MICROSOFT_CLIENT_ID`. In "Value", enter the Application (client) ID. Click "Add variable".
9. If the tenant is not `common`, add the variable `MICROSOFT_TENANT`. Enter `consumers`, `organizations`, or the Directory (tenant) ID.
10. Open the tab "Actions". Click "Deploy BookWriter Pages". Click "Run workflow".
11. Wait until the run is green.

CAUTION: Use the tab "Variables". Do not use the tab "Secrets". A secret is not necessary for a client ID.

NOTE: A build takes the variables when it runs. After you change a variable, run the workflow again.

### 6.2 Option B: one device only

1. Open `https://ghostwriting.ws`.
2. Click "Impostazioni".
3. Find the section "Account cloud: impostazioni, chiavi e libreria su ogni PC".
4. Click "Impostazioni avanzate: Client ID e nome del dispositivo".
5. In "Client ID Google", enter the Google Client ID.
6. In "Application (client) ID Microsoft", enter the Application (client) ID.
7. Keep "common" in "Tenant Microsoft", or enter the other tenant value.
8. Click "Salva Client ID su questo dispositivo".

NOTE: The values that you save on a device have priority over the values of the build. Other devices do not get them.

## 7 Task 4: Test the sign-in

1. Open `https://ghostwriting.ws`. Click "Impostazioni".
2. In the section "Account cloud", click "Accedi con Google" or "Accedi con Microsoft".
3. Select your account in the window that opens. Accept the permission.
4. Make sure that the message "Connesso come ..." shows your account.
5. Select how to protect the credentials. Enter a passphrase of 12 characters or more.
6. Click "Carica impostazioni e chiavi sul cloud".
7. Make sure that the message "Impostazioni e credenziali inviate al cloud" shows.
8. Open a second computer. Do steps 1 to 4 with the same account.
9. Click "Usa il profilo cloud su questo dispositivo". Enter the passphrase.
10. Click "Libreria". Make sure that the books of the first computer show in "Dagli altri tuoi dispositivi".

NOTE: To check the cloud file in Google Drive, you cannot use the Drive website. The folder `appDataFolder` is hidden. In OneDrive, open the folder `Apps/BookWriter`.

## 8 Time limits of the sign-in

Table 3 shows how long a sign-in stays valid.

Table 3: Sign-in time

| Provider | Time | What you do after the time |
| --- | --- | --- |
| Google | About 1 hour | Click "Riconnetti". Often a click is all that you do. |
| Microsoft | 24 hours. BookWriter renews it by itself. | After 24 hours, click "Riconnetti". |
| Google, test mode | The consent expires after 7 days. | Accept the permission again. |

BookWriter works only while the page is open. A sleeping phone or a closed tab does not synchronize.

BookWriter does not have a server. For this reason, Google gives no long sign-in to a web page.

## 9 Troubleshooting

Table 4: Faults and actions

| Fault | Cause | Action |
| --- | --- | --- |
| Google shows "Error 400: origin_mismatch". | The address of the site is not in "Authorized JavaScript origins". | Add the exact address. Do not add a path or a slash at the end. |
| Google shows "Access blocked" or "app not verified". | The status is "Testing" and your account is not a test user. | Add your account as a test user, or publish the app. |
| The sign-in window does not open. | The browser blocks pop-up windows. | Allow pop-ups for `https://ghostwriting.ws`. Click the button again. |
| Microsoft shows "redirect URI mismatch". | The redirect address is different from the address in BookWriter. | Make sure that the address is `https://ghostwriting.ws/oauth/microsoft.html`. It must be exact. |
| Microsoft shows that cross-origin token redemption is permitted only for the "Single-Page Application" client type. | The platform of the redirect address is not "Single-page application". | Remove the address. Add it again with the platform "Single-page application". |
| Microsoft shows "Application not found in the directory". | The Client ID is wrong, or the account type of the app does not include your account. | Copy the Client ID again. Check the "Supported account types". |
| Microsoft shows "Need admin approval". | The tenant of your organization blocks user consent for apps without a verified publisher. | Ask the administrator to approve the app. Or use a personal Microsoft account. |
| BookWriter shows "Client ID ... non valido". | The value has a space, a typing error, or the wrong type. | Copy the value again from the console. |
| BookWriter shows "Sessione cloud scaduta". | The sign-in time ended. | Click "Riconnetti". |
| BookWriter shows "Passphrase errata". | The passphrase is different from the passphrase of the profile. | Enter the passphrase again. There is no recovery if you forget it. |

## 10 Known limits

- Microsoft documents are not consistent about work or school accounts. One page says that the permission `Files.ReadWrite.AppFolder` is for personal accounts only. Other pages say that it works with work and school accounts. Do a test with the account that you want to use.
- An app of a type "multitenant" without a verified publisher shows "Unverified" in the consent screen. A personal account can accept it. Some organizations block it.
- BookWriter supports the fine-grained personal access token of GitHub only. A GitHub App cannot give a token to a web page without a server. GitHub paused this feature in August 2026.

## 11 Remove the access

To stop the sign-in on one device:

1. Click "Impostazioni". Find the section "Account cloud".
2. Click "Scollega questo dispositivo".

To remove the permission of Google:

1. In the same section, click "Scollega e revoca l'accesso di Google".
2. Or open `https://myaccount.google.com/permissions`. Select "BookWriter". Click "Delete all connections".

To remove the permission of Microsoft:

1. For a personal account, open `https://account.live.com/consent/Manage`.
2. For a work or school account, open `https://myapps.microsoft.com`.
3. Select "BookWriter". Remove the access.

To delete the cloud files:

1. In Google Drive, open "Settings", then "Manage apps". Find "BookWriter". Delete the hidden app data.
2. In OneDrive, delete the folder `Apps/BookWriter`.

NOTE: The names in section 11 were not checked in the consoles. The account pages of Google and Microsoft can use other names. Look for the list of apps that have access to your account.

CAUTION: When you delete the cloud files, BookWriter loses the profile and the list of books. The books on GitHub and on your devices stay.

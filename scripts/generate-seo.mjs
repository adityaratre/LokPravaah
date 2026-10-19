import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = process.cwd()
const DEFAULT_SITE_URL = 'https://lokpravaah.online'

function parseEnv(content) {
  const values = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}
function normalizeSiteUrl(raw) {
  try {
    const parsed = new URL(String(raw || '').trim())
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return ''
    return parsed.origin.replace(/\/$/, '')
  } catch { return '' }
}
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function jsonForHtml(value) { return JSON.stringify(value).replaceAll('<', '\\u003c') }

let fileEnv = {}
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { fileEnv = { ...fileEnv, ...parseEnv(await readFile(resolve(root, file), 'utf8')) } } catch { /* optional env file */ }
}
const siteUrl = normalizeSiteUrl(process.env.VITE_SITE_URL || fileEnv.VITE_SITE_URL || DEFAULT_SITE_URL)
if (!siteUrl) throw new Error('[SEO] VITE_SITE_URL must be a valid HTTPS origin.')

const pages = [
  {
    path: '/about/', lang: 'en-IN', alternate: '/hi/about/', section: 'About',
    title: 'About LokPravaah | Independent Civic-Tech Platform in India',
    description: 'Learn how LokPravaah helps people document local civic issues, follow recorded status updates, and organise clearer complaint and RTI drafts. Independent civic tech, not a government portal.',
    h1: 'A clearer record for the civic issues people live with.',
    intro: 'LokPravaah is an independent civic-tech project designed to help people document local public-service concerns, organise useful details, and follow updates recorded against their reports.',
    body: '<section><h2>What can people use LokPravaah for?</h2><p>The platform supports structured reports about everyday civic concerns such as damaged roads and footpaths, waste and sanitation, streetlights, water supply and drainage, public spaces, and other local issues. A report can include a description and location details, so the record is more useful than a vague message.</p><p>Depending on the available features, signed-in users can follow their own reports, see status changes recorded by an authorised account, explore community concerns, and use civic-writing tools to organise a complaint or prepare a draft request for information.</p></section>' +
      '<section><h2>How it works</h2><ol><li><strong>Describe the concern.</strong> Select a category and explain what was observed.</li><li><strong>Add useful location details.</strong> Use an address, nearby landmark, or optional map coordinates.</li><li><strong>Keep a record.</strong> Sign in to submit a report and return to check the saved status.</li><li><strong>Review before sharing.</strong> Do not post passwords, financial details, government ID numbers, or another person’s private information.</li></ol></section>' +
      '<section><h2>Independent, not an official government portal</h2><p>LokPravaah is not operated by a municipal body, state government, or the Government of India. A report here is not automatically filed with a government department and does not guarantee an official response or resolution. For formal action, contact the relevant public authority through its official channel.</p><p>LokPravaah is not an emergency service. For an immediate threat to life or safety, contact the appropriate emergency service.</p></section>' +
      '<section><h2>Who created LokPravaah?</h2><p>LokPravaah is designed and developed by Aditya Ratre as an independent civic-tech project, with the aim of helping people organise local concerns and keep a clearer record of the information they choose to submit.</p></section>' +
      '<section class="questions"><h2>Common questions</h2><details><summary>Does LokPravaah send my report directly to the municipality?</summary><p>No. A report is stored in this platform; it does not automatically go to a government authority.</p></details><details><summary>Can I report an issue near me?</summary><p>You can describe a local issue and add its address or optional map coordinates. The platform does not guarantee action by a local authority.</p></details><details><summary>Is LokPravaah a government website?</summary><p>No. It is an independent civic-tech project and should not be confused with an official government portal.</p></details></section>',
  },
  {
    path: '/report-civic-issue/', lang: 'en-IN', alternate: '/hi/report-civic-issue/', section: 'Civic issue reporting',
    title: 'Report a Local Civic Issue Online in India | LokPravaah',
    description: 'Learn how to make a useful local civic-issue report about roads, waste, streetlights, water or drainage. LokPravaah helps organise details and track recorded updates.',
    h1: 'How to report a local civic issue online',
    intro: 'A clear civic report explains what happened, where it happened, and why it matters. LokPravaah helps people organise those details and keep track of updates recorded in the platform.',
    body: '<section><h2>Issues you can document</h2><p>Local civic problems may include potholes and damaged footpaths, overflowing drains, waste collection concerns, broken streetlights, water leakage, damaged public spaces, and similar public-service issues. Choose the category that fits and describe what you personally observed.</p></section>' +
      '<section><h2>Five steps to make a useful report</h2><ol><li><strong>Pin down the location.</strong> Add the street, area, nearest landmark, or optional map coordinates.</li><li><strong>Describe the specific issue.</strong> Say what is wrong instead of writing only “please fix this”.</li><li><strong>Add timing and impact.</strong> Include when you noticed it and the practical effect, if known.</li><li><strong>Attach evidence only when safe.</strong> A clear photo can help explain a problem. Never put yourself in danger to collect it.</li><li><strong>Track recorded updates.</strong> Sign in and revisit your report. Status changes appear when an authorised account records them.</li></ol></section>' +
      '<section><h2>Checklist by issue type</h2><ul><li><strong>Roads and footpaths:</strong> street or landmark, approximate location of damage, and any accessibility concern.</li><li><strong>Waste and sanitation:</strong> affected public area, type of waste or overflow, and when it was observed.</li><li><strong>Streetlights:</strong> pole or landmark and whether the light is out or damaged.</li><li><strong>Water and drainage:</strong> location of leakage, blockage, or flooding and how long it has been visible, if known.</li><li><strong>Parks and public spaces:</strong> facility or landmark, damage, and its impact on people using the space.</li></ul></section>' +
      '<section><h2>Share responsibly</h2><p>Do not include passwords, UPI PINs, bank details, Aadhaar or PAN numbers, or sensitive documents in a civic report. Be careful when photographing identifiable people. Submit only information you are entitled to share.</p><p>LokPravaah is not an official government complaint portal. Your report is not automatically sent to a local body and does not guarantee resolution. For urgent action, contact the relevant official channel or emergency service.</p></section>' +
      '<section class="questions"><h2>Common questions</h2><details><summary>Can I report an issue near me?</summary><p>You can document a local issue by adding its area, address, landmark, and optional map coordinates.</p></details><details><summary>Will the municipality automatically receive my report?</summary><p>No. You may need to submit a separate complaint through the appropriate official channel.</p></details><details><summary>What if the issue is dangerous right now?</summary><p>Do not wait for an online report. Contact the appropriate emergency service or local authority immediately.</p></details></section>',
  },
  {
    path: '/rti-draft-tool/', lang: 'en-IN', alternate: '/hi/rti-draft-tool/', section: 'RTI draft tool',
    title: 'RTI Draft Tool | Prepare a Right to Information Request in India',
    description: 'Use LokPravaah civic-writing guidance to organise a clear RTI draft: identify the public authority, specify records and dates, and review before official submission.',
    h1: 'Prepare a clearer RTI request draft',
    intro: 'A focused Right to Information (RTI) request is easier to understand when it identifies the public authority and asks for specific records. LokPravaah can help organise a draft; you remain responsible for reviewing and submitting it through the correct official process.',
    body: '<section><h2>What an RTI draft should make clear</h2><ul><li><strong>Public authority:</strong> identify the department or body likely to hold the records.</li><li><strong>Records requested:</strong> ask for identifiable existing documents, such as an order, work record, expenditure statement, inspection report, or recorded status.</li><li><strong>Time period:</strong> state relevant dates, project, location, or reference number where known.</li><li><strong>Numbered questions:</strong> separate distinct records or requests.</li><li><strong>Required details:</strong> provide information required by the official filing process, not unnecessary sensitive details in an AI prompt.</li></ul></section>' +
      '<section><h2>Ask for records, not a broad opinion</h2><p>Instead of “Why is the road not repaired?”, a focused request might ask for copies of the sanctioned work order, inspection record, completion report, or recorded correspondence for a stated period. Keep each request neutral and specific. Do not assume that a particular document must exist.</p></section>' +
      '<section><h2>Before you submit</h2><ol><li>Check that the department is the correct public authority.</li><li>Review each item for clarity, date range, and relevance.</li><li>Remove duplicate, vague, or unrelated questions.</li><li>Check the current official RTI process, Public Information Officer details, fee rules, accepted payment methods, and applicable exemptions.</li><li>Save the submitted version and the acknowledgement or reference provided by the official channel.</li></ol></section>' +
      '<section><h2>Important limitations</h2><p>LokPravaah is an independent civic-tech platform, not an official government portal or legal service. Preparing a draft here does not file an RTI request, pay a fee, or create an official acknowledgement. Verify the current process before submission.</p><p>Do not share passwords, UPI PINs, OTPs, or banking credentials with an AI tool. Review generated wording carefully.</p></section>' +
      '<section class="questions"><h2>Common questions</h2><details><summary>Does LokPravaah file the RTI for me?</summary><p>No. It helps organise a draft only. You must review and submit it through the proper official process.</p></details><details><summary>Can I ask why something happened?</summary><p>You may be able to request recorded reasons or related records held by a public authority. Specific requests for existing records are generally clearer.</p></details><details><summary>Is an AI-generated RTI draft guaranteed to be legally correct?</summary><p>No. Confirm the authority and current rules before submitting.</p></details></section>',
  },
  {
    path: '/civic-ai-assistant/', lang: 'en-IN', alternate: '/hi/civic-ai-assistant/', section: 'Civic AI assistant',
    title: 'Civic AI Assistant for Complaint Writing and RTI Drafts | LokPravaah',
    description: 'Learn how LokPravaah’s civic-writing tools can help organise issue descriptions, complaint wording and RTI drafts while keeping human review and official processes in control.',
    h1: 'A civic AI assistant for clearer writing',
    intro: 'Explaining a public issue clearly can take time. LokPravaah’s civic-writing tools are designed to help organise information and prepare a starting draft for a report, complaint, or RTI request.',
    body: '<section><h2>What a writing assistant can help with</h2><ul><li>Turn rough notes about a civic problem into a clearer description.</li><li>Organise location, observed condition, dates, and practical impact.</li><li>Suggest a neutral structure for a complaint letter.</li><li>Help shape a focused RTI request for identifiable records.</li><li>Highlight details that need checking before a report is submitted.</li></ul></section>' +
      '<section><h2>Keep people in control</h2><p>AI output can be incomplete, outdated, or incorrect. Check names, addresses, dates, legal references, public authority details, and factual claims before using a draft. Do not present a guess as verified fact. For legal advice or formal action, consult official information or a qualified professional.</p></section>' +
      '<section><h2>Protect private information</h2><p>Only enter information needed for the task. Do not share passwords, UPI PINs, OTPs, bank credentials, Aadhaar or PAN numbers, or another person’s private information. Remove unnecessary identifiers before sharing a draft.</p></section>' +
      '<section><h2>Not an official or emergency service</h2><p>LokPravaah is an independent civic-tech project. AI-assisted wording does not file a complaint with a department or guarantee a response. For immediate safety risks, contact the appropriate emergency service.</p></section>' +
      '<section class="questions"><h2>Common questions</h2><details><summary>Can AI submit the complaint automatically?</summary><p>No. Review the draft and submit it through the official channel when formal submission is required.</p></details><details><summary>Should I trust every legal statement suggested by AI?</summary><p>No. Independently check important claims and current rules.</p></details></section>',
  },
  {
    path: '/civic-issue-guides/', lang: 'en-IN', alternate: '/hi/civic-issue-guides/', section: 'Civic issue guides',
    title: 'Civic Issue Reporting Guides and Checklists | LokPravaah',
    description: 'Practical checklists for documenting potholes, waste, streetlights, water and drainage concerns. Make local civic reports clearer with LokPravaah.',
    h1: 'Practical guides for documenting local issues',
    intro: 'Useful reports are specific, factual, and safe to prepare. These checklists help you gather the details that may make a local civic issue easier to understand.',
    body: '<section><h2>Road damage and footpath problems</h2><p>Record the street or nearby landmark, approximate location of damage, and its effect on walking, accessibility, or traffic. Photograph it only from a safe place. Never step into moving traffic to collect evidence.</p></section>' +
      '<section><h2>Waste and sanitation</h2><p>Describe the public location, type of waste or overflow, and when you noticed it. Avoid touching hazardous waste or confronting people. For an immediate health hazard, contact the relevant local service directly.</p></section>' +
      '<section><h2>Streetlights and public safety</h2><p>Identify the pole, street, or landmark and state whether the light is out or damaged. If exposed wiring, fire, or an immediate threat is present, keep away and contact the appropriate emergency or utility service.</p></section>' +
      '<section><h2>Water leaks, drains and flooding</h2><p>Note the address, water accumulation, and approximate duration. Avoid entering floodwater or open drains. Do not claim a cause unless it has been verified.</p></section>' +
      '<section><h2>Turn observations into a clear record</h2><ol><li>Separate what you personally saw from what you were told.</li><li>Give a precise location and useful time period.</li><li>Use neutral language and avoid unsupported accusations.</li><li>Remove faces, number plates, and private information when not needed.</li><li>Keep the reference number and review recorded status changes.</li></ol></section>' +
      '<section><h2>Where LokPravaah fits</h2><p>LokPravaah helps organise reports and updates within the platform. It is not an official government portal, emergency service, or guarantee of local authority action. For formal complaints or urgent danger, contact the relevant official service directly.</p></section>',
  },
  {
    path: '/hi/', lang: 'hi-IN', section: 'मुखपृष्ठ',
    title: 'LokPravaah | स्थानीय नागरिक समस्या रिपोर्ट और RTI ड्राफ्ट टूल',
    description: 'अपने इलाके की सड़क, सफाई, स्ट्रीट लाइट, पानी या ड्रेनेज जैसी समस्याओं का स्पष्ट विवरण तैयार करें। LokPravaah एक स्वतंत्र नागरिक तकनीक प्लेटफ़ॉर्म है।',
    h1: 'बेहतर मोहल्ले की शुरुआत आपकी आवाज़ से होती है',
    intro: 'स्थानीय नागरिक समस्याओं का विवरण दर्ज करें, रिपोर्ट में सही स्थान जोड़ें और प्लेटफ़ॉर्म पर दर्ज अपडेट देखें। LokPravaah लोगों को अपनी बात व्यवस्थित रूप से रखने में मदद करता है।',
    body: '<section><h2>अपने क्षेत्र की समस्याएँ स्पष्ट तरीके से दर्ज करें</h2><p>सड़क और फुटपाथ, कचरा और सफाई, स्ट्रीट लाइट, पानी और ड्रेनेज, पार्क और सार्वजनिक स्थान जैसी समस्याओं का तथ्यात्मक विवरण बनाएं। सही श्रेणी, नज़दीकी पहचान-चिह्न और उपयोगी विवरण रिपोर्ट को समझना आसान बनाते हैं।</p></section>' +
      '<section><h2>रिपोर्ट से लेकर अपडेट तक</h2><ol><li>समस्या और उसके स्थान का विवरण तैयार करें।</li><li>ज़रूरत हो तो सुरक्षित फोटो या वैकल्पिक लोकेशन विवरण जोड़ें।</li><li>प्लेटफ़ॉर्म पर रिपोर्ट दर्ज करने के लिए साइन इन करें।</li><li>अधिकृत खाते द्वारा दर्ज स्थिति बदलाव देखें।</li></ol></section>' +
      '<section><h2>नागरिक लेखन और RTI ड्राफ्ट</h2><p>LokPravaah के civic-writing tools शिकायत को व्यवस्थित करने या सूचना का अधिकार (RTI) आवेदन का शुरुआती ड्राफ्ट बनाने में मदद कर सकते हैं। हर तथ्य और कानूनी संदर्भ जाँचें। ड्राफ्ट को आधिकारिक माध्यम से अलग से जमा करना होगा।</p></section>' +
      '<section><h2>स्वतंत्र परियोजना, सरकारी पोर्टल नहीं</h2><p>LokPravaah किसी सरकारी विभाग का आधिकारिक पोर्टल नहीं है। यहाँ की रिपोर्ट अपने-आप नगर निगम या सरकारी कार्यालय में दर्ज नहीं होती और कार्रवाई की गारंटी नहीं मिलती। तत्काल खतरे के लिए संबंधित आपातकालीन सेवा से संपर्क करें।</p></section>',
  },
  {
    path: '/hi/about/', lang: 'hi-IN', alternate: '/about/', section: 'लोकप्रवाह के बारे में',
    title: 'LokPravaah क्या है? | स्थानीय नागरिक समस्याओं के लिए Civic-Tech Platform',
    description: 'LokPravaah एक स्वतंत्र civic-tech platform है, जहाँ लोग स्थानीय सड़क, सफाई, स्ट्रीट लाइट, पानी और ड्रेनेज जैसी समस्याओं का विवरण व्यवस्थित कर सकते हैं और दर्ज अपडेट देख सकते हैं।',
    h1: 'स्थानीय समस्याओं का स्पष्ट रिकॉर्ड, नागरिकों की आवाज़ के साथ',
    intro: 'LokPravaah एक स्वतंत्र civic-tech परियोजना है। इसका उद्देश्य लोगों को अपने क्षेत्र की सार्वजनिक समस्याओं का विवरण व्यवस्थित करने और प्लेटफ़ॉर्म पर दर्ज अपडेट देखने में मदद करना है।',
    body: '<section><h2>LokPravaah का उपयोग किस लिए किया जा सकता है?</h2><p>आप सड़क और फुटपाथ की खराब स्थिति, कचरा और सफाई, स्ट्रीट लाइट, पानी की आपूर्ति, ड्रेनेज, सार्वजनिक स्थानों और अन्य स्थानीय नागरिक समस्याओं का विवरण दे सकते हैं। स्पष्ट श्रेणी, स्थान और तथ्यात्मक विवरण रिपोर्ट को समझने में मदद करता है।</p><p>उपलब्ध सुविधाओं के अनुसार, साइन इन करने वाले उपयोगकर्ता अपनी रिपोर्ट और अधिकृत खाते द्वारा दर्ज स्थिति बदलाव देख सकते हैं तथा शिकायत या RTI ड्राफ्ट के लिए लेखन टूल का उपयोग कर सकते हैं।</p></section>' +
      '<section><h2>यह कैसे काम करता है?</h2><ol><li><strong>समस्या बताएँ:</strong> उपयुक्त श्रेणी चुनें और स्पष्ट विवरण लिखें।</li><li><strong>स्थान जोड़ें:</strong> पता, नज़दीकी पहचान-चिह्न या वैकल्पिक मैप निर्देशांक दें।</li><li><strong>रिकॉर्ड रखें:</strong> रिपोर्ट दर्ज करने के लिए साइन इन करें और बाद में सहेजी गई स्थिति देखें।</li><li><strong>सावधानी से साझा करें:</strong> पासवर्ड, बैंक विवरण, UPI PIN या किसी दूसरे व्यक्ति की निजी जानकारी न डालें।</li></ol></section>' +
      '<section><h2>यह सरकारी वेबसाइट नहीं है</h2><p>LokPravaah किसी नगर निगम, राज्य सरकार या भारत सरकार का आधिकारिक पोर्टल नहीं है। यहाँ रिपोर्ट दर्ज करने से शिकायत अपने-आप किसी सरकारी विभाग को नहीं जाती और कार्रवाई या समाधान की गारंटी नहीं मिलती। औपचारिक कार्रवाई के लिए संबंधित विभाग के आधिकारिक माध्यम का भी उपयोग करें।</p><p>यह आपातकालीन सेवा नहीं है। जान या सुरक्षा के तत्काल खतरे में उचित आपातकालीन सेवा से संपर्क करें।</p></section>' +
      '<section><h2>LokPravaah किसने बनाया?</h2><p>LokPravaah को Aditya Ratre ने स्वतंत्र civic-tech परियोजना के रूप में डिज़ाइन और विकसित किया है।</p></section>' +
      '<section class="questions"><h2>अक्सर पूछे जाने वाले सवाल</h2><details><summary>क्या मेरी रिपोर्ट सीधे नगर निगम को भेजी जाती है?</summary><p>नहीं। रिपोर्ट इस प्लेटफ़ॉर्म में दर्ज होती है। सरकारी विभाग को अलग से आधिकारिक शिकायत देनी पड़ सकती है।</p></details><details><summary>क्या LokPravaah सरकारी पोर्टल है?</summary><p>नहीं। यह एक स्वतंत्र civic-tech परियोजना है।</p></details></section>',
  },
  {
    path: '/hi/report-civic-issue/', lang: 'hi-IN', alternate: '/report-civic-issue/', section: 'नागरिक समस्या रिपोर्ट करना',
    title: 'अपने इलाके की नागरिक समस्या ऑनलाइन रिपोर्ट करें | LokPravaah',
    description: 'सड़क, कचरा, स्ट्रीट लाइट, पानी या ड्रेनेज की स्थानीय समस्या का स्पष्ट विवरण तैयार करें। LokPravaah में स्थान जोड़ें और दर्ज अपडेट देख सकें।',
    h1: 'अपने इलाके की नागरिक समस्या ऑनलाइन कैसे रिपोर्ट करें',
    intro: 'एक उपयोगी रिपोर्ट बताती है कि समस्या क्या है, कहाँ है और उसका क्या असर पड़ रहा है। LokPravaah इन विवरणों को व्यवस्थित करने और प्लेटफ़ॉर्म पर दर्ज अपडेट देखने में मदद करता है।',
    body: '<section><h2>किस प्रकार की समस्याएँ दर्ज कर सकते हैं?</h2><p>आप गड्ढे और खराब फुटपाथ, नाली का जाम या ओवरफ्लो, कचरा, बंद स्ट्रीट लाइट, पानी का रिसाव, सार्वजनिक स्थान की खराब स्थिति और ऐसी अन्य समस्याओं का विवरण दे सकते हैं। जो आपने स्वयं देखा है, उसे साफ़ शब्दों में लिखें।</p></section>' +
      '<section><h2>अच्छी रिपोर्ट बनाने के पाँच चरण</h2><ol><li><strong>सही स्थान लिखें:</strong> सड़क, क्षेत्र, नज़दीकी पहचान-चिह्न या वैकल्पिक मैप लोकेशन दें।</li><li><strong>समस्या स्पष्ट करें:</strong> गड्ढा, रास्ते की रुकावट या नाली की स्थिति का सही विवरण दें।</li><li><strong>समय और असर बताएँ:</strong> समस्या कब देखी और क्या असर है—यदि पता हो।</li><li><strong>सुरक्षित प्रमाण जोड़ें:</strong> फोटो तभी लें जब सुरक्षित हो।</li><li><strong>दर्ज स्थिति देखें:</strong> साइन इन करके रिपोर्ट और उपलब्ध स्थिति बदलाव देखें।</li></ol></section>' +
      '<section><h2>समस्या के अनुसार चेकलिस्ट</h2><ul><li><strong>सड़क/फुटपाथ:</strong> स्थान, नुकसान का अनुमानित क्षेत्र और आने-जाने में परेशानी।</li><li><strong>कचरा/सफाई:</strong> प्रभावित स्थान, कचरे का प्रकार और कब देखा।</li><li><strong>स्ट्रीट लाइट:</strong> पोल या पहचान-चिह्न और लाइट की स्थिति।</li><li><strong>पानी/ड्रेनेज:</strong> रिसाव, जाम या जलभराव का स्थान और अवधि।</li><li><strong>सार्वजनिक स्थान:</strong> खराब सुविधा और लोगों के उपयोग पर असर।</li></ul></section>' +
      '<section><h2>निजी जानकारी और सुरक्षा</h2><p>रिपोर्ट में पासवर्ड, UPI PIN, OTP, बैंक विवरण, आधार या PAN नंबर न लिखें। निजी पहचान और किसी अन्य व्यक्ति की जानकारी साझा करने से बचें। LokPravaah सरकारी शिकायत पोर्टल नहीं है; रिपोर्ट अपने-आप विभाग को नहीं जाती और समाधान की गारंटी नहीं है।</p></section>' +
      '<section class="questions"><h2>अक्सर पूछे जाने वाले सवाल</h2><details><summary>क्या मैं अपने आसपास की समस्या रिपोर्ट कर सकता हूँ?</summary><p>हाँ। क्षेत्र, पता, नज़दीकी पहचान-चिह्न और वैकल्पिक मैप निर्देशांक जोड़ सकते हैं।</p></details><details><summary>क्या नगर निगम को रिपोर्ट अपने-आप मिलेगी?</summary><p>नहीं। आधिकारिक शिकायत अलग से देनी पड़ सकती है।</p></details></section>',
  },
  {
    path: '/hi/rti-draft-tool/', lang: 'hi-IN', alternate: '/rti-draft-tool/', section: 'RTI ड्राफ्ट टूल',
    title: 'RTI Draft Tool | सूचना का अधिकार आवेदन का ड्राफ्ट बनाएँ | LokPravaah',
    description: 'LokPravaah की मदद से RTI आवेदन का स्पष्ट ड्राफ्ट व्यवस्थित करें—संबंधित सार्वजनिक प्राधिकरण, माँगे गए रिकॉर्ड और समयावधि तय करें। जमा करने से पहले आधिकारिक नियम जाँचें।',
    h1: 'सूचना का अधिकार (RTI) आवेदन का स्पष्ट ड्राफ्ट तैयार करें',
    intro: 'RTI अनुरोध तब समझना आसान होता है जब संबंधित सार्वजनिक प्राधिकरण और माँगे गए रिकॉर्ड स्पष्ट हों। LokPravaah ड्राफ्ट व्यवस्थित करने में मदद कर सकता है, लेकिन समीक्षा और आधिकारिक रूप से जमा करना आपकी जिम्मेदारी है।',
    body: '<section><h2>RTI ड्राफ्ट में क्या स्पष्ट होना चाहिए?</h2><ul><li><strong>संबंधित विभाग:</strong> पता करें कि रिकॉर्ड किस सार्वजनिक प्राधिकरण के पास होने की संभावना है।</li><li><strong>माँगे गए रिकॉर्ड:</strong> आदेश की प्रति, कार्य रिकॉर्ड, खर्च का विवरण या निरीक्षण रिपोर्ट जैसे मौजूदा दस्तावेज़ माँगें।</li><li><strong>समयावधि:</strong> संबंधित तारीख, परियोजना, स्थान या संदर्भ संख्या दें।</li><li><strong>अलग-अलग बिंदु:</strong> हर रिकॉर्ड या अनुरोध को अलग लिखें।</li><li><strong>ज़रूरी जानकारी:</strong> आधिकारिक प्रक्रिया में आवश्यक विवरण ही दें।</li></ul></section>' +
      '<section><h2>व्यापक राय के बजाय रिकॉर्ड माँगें</h2><p>“सड़क ठीक क्यों नहीं हुई?” के बजाय स्वीकृत कार्य आदेश, निरीक्षण रिपोर्ट, खर्च का रिकॉर्ड या तय अवधि के पत्राचार की प्रतियाँ माँगना अधिक स्पष्ट हो सकता है। तटस्थ भाषा रखें और यह न मानें कि हर दस्तावेज़ मौजूद ही होगा।</p></section>' +
      '<section><h2>जमा करने से पहले जाँचें</h2><ol><li>सही सार्वजनिक प्राधिकरण की पुष्टि करें।</li><li>हर बिंदु में रिकॉर्ड, तारीख और विषय स्पष्ट रखें।</li><li>दोहराए गए या अस्पष्ट प्रश्न हटाएँ।</li><li>आधिकारिक माध्यम पर वर्तमान आवेदन प्रक्रिया, लोक सूचना अधिकारी, फीस और लागू नियम जाँचें।</li><li>आवेदन और acknowledgement की प्रति सुरक्षित रखें।</li></ol></section>' +
      '<section><h2>महत्वपूर्ण सीमा</h2><p>LokPravaah सरकारी पोर्टल या कानूनी सेवा नहीं है। यहाँ ड्राफ्ट बनाने से RTI अपने-आप जमा नहीं होती, फीस नहीं भरी जाती और आधिकारिक रसीद नहीं मिलती। पासवर्ड, बैंक विवरण, UPI PIN या OTP किसी AI टूल में न डालें।</p></section>' +
      '<section class="questions"><h2>अक्सर पूछे जाने वाले सवाल</h2><details><summary>क्या LokPravaah मेरी RTI जमा करेगा?</summary><p>नहीं। आपको ड्राफ्ट की समीक्षा करके सही आधिकारिक माध्यम से आवेदन जमा करना होगा।</p></details><details><summary>क्या AI का RTI ड्राफ्ट हमेशा कानूनी रूप से सही होगा?</summary><p>नहीं। विभाग और वर्तमान नियम खुद जाँचें।</p></details></section>',
  },
  {
    path: '/hi/civic-ai-assistant/', lang: 'hi-IN', alternate: '/civic-ai-assistant/', section: 'नागरिक AI सहायक',
    title: 'Civic AI Assistant | शिकायत और RTI ड्राफ्ट लिखने में मदद | LokPravaah',
    description: 'LokPravaah के civic-writing tools से स्थानीय समस्या का विवरण, शिकायत पत्र या RTI ड्राफ्ट व्यवस्थित करें। AI के जवाब की समीक्षा करें और आधिकारिक प्रक्रिया जाँचें।',
    h1: 'स्पष्ट शिकायत लिखने में मदद करने वाला Civic AI Assistant',
    intro: 'स्थानीय समस्या का स्पष्ट विवरण या शिकायत लिखना समय ले सकता है। LokPravaah के civic-writing tools जानकारी व्यवस्थित करने और शुरुआती ड्राफ्ट बनाने में मदद करने के लिए हैं।',
    body: '<section><h2>लेखन सहायक किस तरह मदद कर सकता है?</h2><ul><li>बिखरे हुए नोट्स को स्पष्ट समस्या विवरण में व्यवस्थित करना।</li><li>स्थान, तारीख, दिखाई देने वाली स्थिति और असर को जोड़ना।</li><li>शिकायत पत्र की तटस्थ संरचना सुझाना।</li><li>विशिष्ट रिकॉर्ड माँगने वाले RTI ड्राफ्ट को व्यवस्थित करना।</li><li>जमा करने से पहले जाँचने वाले विवरण पहचानना।</li></ul></section>' +
      '<section><h2>अंतिम नियंत्रण आपके पास रहे</h2><p>AI का जवाब अधूरा, पुराना या गलत हो सकता है। नाम, पता, तारीख, कानूनी संदर्भ, विभाग और हर तथ्य की पुष्टि करें। कानूनी सलाह के लिए योग्य पेशेवर या आधिकारिक जानकारी का सहारा लें।</p></section>' +
      '<section><h2>निजी जानकारी सुरक्षित रखें</h2><p>केवल आवश्यक जानकारी डालें। पासवर्ड, UPI PIN, OTP, बैंक credentials, आधार/PAN नंबर या किसी अन्य व्यक्ति की निजी जानकारी साझा न करें।</p></section>' +
      '<section><h2>यह सरकारी या आपातकालीन सेवा नहीं है</h2><p>LokPravaah एक स्वतंत्र civic-tech परियोजना है। AI से मिला ड्राफ्ट किसी सरकारी विभाग में शिकायत जमा नहीं करता और उत्तर या समाधान की गारंटी नहीं देता। तत्काल खतरे में उचित आपातकालीन सेवा से संपर्क करें।</p></section>' +
      '<section class="questions"><h2>अक्सर पूछे जाने वाले सवाल</h2><details><summary>क्या AI मेरी शिकायत अपने-आप भेज देगा?</summary><p>नहीं। औपचारिक शिकायत की समीक्षा करके उचित आधिकारिक माध्यम से जमा करनी होगी।</p></details><details><summary>क्या AI का हर कानूनी सुझाव सही होता है?</summary><p>नहीं। महत्वपूर्ण तथ्यों और वर्तमान नियमों की स्वतंत्र पुष्टि करें।</p></details></section>',
  },
  {
    path: '/hi/civic-issue-guides/', lang: 'hi-IN', alternate: '/civic-issue-guides/', section: 'नागरिक समस्या गाइड',
    title: 'स्थानीय नागरिक समस्याओं के लिए रिपोर्टिंग गाइड और चेकलिस्ट | LokPravaah',
    description: 'सड़क के गड्ढे, कचरा, स्ट्रीट लाइट, पानी और ड्रेनेज की समस्या दर्ज करने की चेकलिस्ट। LokPravaah पर स्पष्ट स्थानीय रिपोर्ट तैयार करें।',
    h1: 'स्थानीय समस्याओं का विवरण दर्ज करने के लिए आसान गाइड',
    intro: 'एक उपयोगी रिपोर्ट तथ्यात्मक, स्पष्ट और सुरक्षित तरीके से तैयार की जाती है। ये चेकलिस्ट स्थानीय समस्या को बेहतर तरीके से समझाने के लिए ज़रूरी विवरण जुटाने में मदद करती हैं।',
    body: '<section><h2>सड़क और फुटपाथ</h2><p>सड़क या पहचान-चिह्न, नुकसान का अनुमानित स्थान और पैदल चलने या यातायात पर असर लिखें। फोटो केवल सुरक्षित जगह से लें।</p></section>' +
      '<section><h2>कचरा और सफाई</h2><p>प्रभावित सार्वजनिक स्थान, कचरे या ओवरफ्लो का प्रकार और कब देखा, यह लिखें। खतरनाक कचरे को न छुएँ। तत्काल स्वास्थ्य खतरे में संबंधित स्थानीय सेवा से संपर्क करें।</p></section>' +
      '<section><h2>स्ट्रीट लाइट और सुरक्षा</h2><p>पोल या पहचान-चिह्न और लाइट की स्थिति लिखें। खुले बिजली तार या तत्काल खतरे में दूरी बनाए रखें और उचित आपातकालीन या बिजली सेवा से सीधे संपर्क करें।</p></section>' +
      '<section><h2>पानी का रिसाव, नाली और जलभराव</h2><p>स्थान, पानी जमा होने की सीमा और समस्या की अवधि लिखें। बाढ़ के पानी या खुले नाले में न उतरें। बिना पुष्टि कारण का दावा न करें।</p></section>' +
      '<section><h2>स्पष्ट और जिम्मेदार रिकॉर्ड बनाएँ</h2><ol><li>खुद देखी बात और दूसरों से सुनी बात को अलग रखें।</li><li>सटीक स्थान और समय बताएँ।</li><li>तटस्थ भाषा रखें और बिना प्रमाण आरोप न लगाएँ।</li><li>अनावश्यक निजी जानकारी हटाएँ।</li><li>रिपोर्ट का संदर्भ सुरक्षित रखें और दर्ज अपडेट देखते रहें।</li></ol></section>' +
      '<section><h2>LokPravaah की भूमिका</h2><p>LokPravaah रिपोर्ट और प्लेटफ़ॉर्म पर दर्ज अपडेट व्यवस्थित करने में मदद करता है। यह सरकारी पोर्टल, आपातकालीन सेवा या स्थानीय विभाग की कार्रवाई की गारंटी नहीं है।</p></section>',
  },
]

const home = '<section><h2>Local civic issue reporting</h2><p>Use LokPravaah to organise details about local roads, waste, streetlights, water, drainage, parks, and other civic concerns. Add a useful location and follow status updates recorded in the platform.</p></section>' +
  '<section><h2>How to get started</h2><ol><li>Describe the concern in clear, factual language.</li><li>Add the area, address, landmark or optional map coordinates.</li><li>Sign in to submit reports and review your own activity.</li></ol></section>' +
  '<section><h2>Independent civic tech</h2><p>LokPravaah is not an official government portal. Reports are not automatically sent to a government department and do not guarantee resolution. Contact the relevant official channel for formal action and emergency services for immediate danger.</p></section>'
const homeHindi = {
  path: '/hi/', lang: 'hi-IN', section: 'मुखपृष्ठ',
  title: 'LokPravaah | स्थानीय नागरिक समस्या रिपोर्ट और RTI ड्राफ्ट टूल',
  description: 'अपने इलाके की सड़क, सफाई, स्ट्रीट लाइट, पानी या ड्रेनेज जैसी समस्याओं का स्पष्ट विवरण तैयार करें। LokPravaah एक स्वतंत्र नागरिक तकनीक प्लेटफ़ॉर्म है।',
  h1: 'बेहतर मोहल्ले की शुरुआत आपकी आवाज़ से होती है',
  intro: 'स्थानीय नागरिक समस्याओं का विवरण दर्ज करें, रिपोर्ट में सही स्थान जोड़ें और प्लेटफ़ॉर्म पर दर्ज अपडेट देखें। LokPravaah लोगों को अपनी बात व्यवस्थित रूप से रखने में मदद करता है।',
  body: '<section><h2>अपने क्षेत्र की समस्याएँ स्पष्ट तरीके से दर्ज करें</h2><p>सड़क और फुटपाथ, कचरा और सफाई, स्ट्रीट लाइट, पानी और ड्रेनेज, पार्क और सार्वजनिक स्थान जैसी समस्याओं का तथ्यात्मक विवरण बनाएं। सही श्रेणी, नज़दीकी पहचान-चिह्न और उपयोगी विवरण रिपोर्ट को समझना आसान बनाते हैं।</p></section>' +
    '<section><h2>रिपोर्ट से लेकर अपडेट तक</h2><ol><li>समस्या और उसके स्थान का विवरण तैयार करें।</li><li>ज़रूरत हो तो सुरक्षित फोटो या वैकल्पिक लोकेशन विवरण जोड़ें।</li><li>प्लेटफ़ॉर्म पर रिपोर्ट दर्ज करने के लिए साइन इन करें।</li><li>अधिकृत खाते द्वारा दर्ज स्थिति बदलाव देखें।</li></ol></section>' +
    '<section><h2>नागरिक लेखन और RTI ड्राफ्ट</h2><p>LokPravaah के civic-writing tools शिकायत को व्यवस्थित करने या सूचना का अधिकार (RTI) आवेदन का शुरुआती ड्राफ्ट बनाने में मदद कर सकते हैं। हर तथ्य और कानूनी संदर्भ जाँचें। ड्राफ्ट को आधिकारिक माध्यम से अलग से जमा करना होगा।</p></section>' +
    '<section><h2>स्वतंत्र परियोजना, सरकारी पोर्टल नहीं</h2><p>LokPravaah किसी सरकारी विभाग का आधिकारिक पोर्टल नहीं है। यहाँ की रिपोर्ट अपने-आप नगर निगम या सरकारी कार्यालय में दर्ज नहीं होती और कार्रवाई की गारंटी नहीं मिलती। तत्काल खतरे के लिए संबंधित आपातकालीन सेवा से संपर्क करें।</p></section>' +
    '<section><h2>और जानें</h2><p><a href="/hi/about/">LokPravaah के बारे में</a> · <a href="/hi/report-civic-issue/">नागरिक समस्या रिपोर्ट करें</a> · <a href="/hi/rti-draft-tool/">RTI ड्राफ्ट टूल</a> · <a href="/hi/civic-ai-assistant/">Civic AI Assistant</a> · <a href="/hi/civic-issue-guides/">समस्या गाइड</a></p></section>',
}

const homePage = {
  path: '/', lang: 'en-IN', section: 'Home',
  title: 'LokPravaah | Local Civic Issue Reporting & RTI Draft Tool',
  description: 'Report local civic issues, track recorded updates, and prepare complaint or RTI drafts online. LokPravaah is an independent civic-tech platform—not a government portal.',
  h1: 'Better neighbourhoods start with your voice.',
  intro: 'Report everyday civic issues, add clear location details, and follow recorded updates. LokPravaah helps citizens organise local concerns in one place.',
  body: home,
}
const allPages = [homePage, ...pages, homeHindi]
const pageByPath = new Map(allPages.map(page => [page.path, page]))
const navItems = [
  { path: '/about/', label: 'About', hi: 'परिचय' },
  { path: '/report-civic-issue/', label: 'Report a civic issue', hi: 'समस्या रिपोर्ट करें' },
  { path: '/rti-draft-tool/', label: 'RTI draft tool', hi: 'RTI ड्राफ्ट' },
  { path: '/civic-ai-assistant/', label: 'Civic AI assistant', hi: 'Civic AI सहायक' },
  { path: '/civic-issue-guides/', label: 'Issue guides', hi: 'समस्या गाइड' },
]
function alternates(page) {
  if (!page.alternate || !pageByPath.has(page.alternate)) return ''
  const other = pageByPath.get(page.alternate)
  const en = page.lang === 'en-IN' ? page : other
  const hi = page.lang === 'hi-IN' ? page : other
  return '<link rel="alternate" hreflang="en-IN" href="' + siteUrl + en.path + '">' +
    '<link rel="alternate" hreflang="hi-IN" href="' + siteUrl + hi.path + '">' +
    '<link rel="alternate" hreflang="x-default" href="' + siteUrl + en.path + '">'
}
function renderPage(page) {
  const hindi = page.lang === 'hi-IN'
  const homePath = hindi ? '/hi/' : '/'
  const menu = navItems.map(item => '<a href="' + (hindi ? '/hi' + item.path : item.path) + '">' + (hindi ? item.hi : item.label) + '</a>').join('\n')
  const related = navItems.map(item => '<a href="' + (hindi ? '/hi' + item.path : item.path) + '">' + (hindi ? item.hi : item.label) + '</a>').join(' · ')
  const canonical = siteUrl + page.path
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url: canonical,
    inLanguage: page.lang,
    isPartOf: { '@type': 'WebSite', name: 'LokPravaah', url: siteUrl + '/' },
    breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'LokPravaah', item: siteUrl + homePath },
      { '@type': 'ListItem', position: 2, name: page.section, item: canonical },
    ] },
  }
  const css = ':root{color-scheme:light;--ink:#12231f;--muted:#536963;--line:#dce9e3;--green:#087f5b;--mint:#b8f4d7}*{box-sizing:border-box}body{margin:0;background:#f7faf8;color:var(--ink);font:16px/1.75 system-ui,-apple-system,Segoe UI,sans-serif}a{color:#087653;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #e4a93d;outline-offset:3px}.site-head{max-width:1120px;margin:auto;padding:16px 22px;display:flex;align-items:center;gap:22px;flex-wrap:wrap;border-bottom:1px solid var(--line)}.brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);font-weight:850;font-size:19px;white-space:nowrap}.brand img{border-radius:10px}.site-head nav{display:flex;gap:16px;flex:1;flex-wrap:wrap}.site-head nav a{font-size:13px;font-weight:650;text-decoration:none;color:var(--muted)}.head-cta{padding:9px 14px;border-radius:10px;background:var(--green);color:#fff;text-decoration:none;font-size:13px;font-weight:750}.hero{padding:52px 22px 38px;background:radial-gradient(ellipse at top right,#ddf9e9 0,transparent 48%),linear-gradient(#fff,#f7faf8)}.hero-inner,.content,.bottom-cta,.site-foot{max-width:900px;margin:0 auto}.eyebrow{color:var(--green);font-size:12px;font-weight:850;letter-spacing:.13em;text-transform:uppercase}.hero h1{max-width:820px;margin:10px 0 14px;font-size:clamp(32px,5.2vw,56px);line-height:1.12;letter-spacing:-.045em}.hero p{max-width:740px;color:#415951;font-size:18px;line-height:1.75;margin:0}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:25px}.hero-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:45px;padding:10px 17px;border-radius:11px;text-decoration:none;font-size:14px;font-weight:800}.primary{background:var(--green);color:white}.secondary{background:white;border:1px solid var(--line);color:var(--ink)}.content{padding:8px 22px 40px}.content section{margin:26px 0;padding:24px;background:#fff;border:1px solid var(--line);border-radius:16px}.content h2{font-size:23px;line-height:1.3;letter-spacing:-.025em;margin:0 0 12px}.content p{margin:10px 0;color:#334c44}.content li{padding-left:4px;margin:7px 0;color:#334c44}.content ul,.content ol{padding-left:23px}.content .questions details{border-top:1px solid var(--line);padding:13px 0}.content summary{cursor:pointer;font-weight:750}.content details p{font-size:15px}.breadcrumbs{font-size:12px;color:var(--muted);margin:0 0 16px}.breadcrumbs a{color:var(--muted)}.bottom-cta{margin-bottom:40px;padding:24px 22px}.bottom-cta-card{background:#0b211d;color:#fff;padding:28px;border-radius:18px;display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap}.bottom-cta-card h2{font-size:25px;line-height:1.25;margin:0 0 8px}.bottom-cta-card p{margin:0;color:#d5e7df;max-width:570px}.bottom-cta-card a{background:var(--mint);color:#12382a;text-decoration:none;font-weight:850;padding:12px 17px;border-radius:10px;white-space:nowrap}.site-foot{padding:8px 22px 36px;color:var(--muted);font-size:12px}.foot-links{display:flex;gap:10px 18px;flex-wrap:wrap;margin:14px 0}.foot-links a{font-weight:650}.disclaimer{padding-top:14px;border-top:1px solid var(--line)}@media(max-width:700px){.site-head{gap:12px}.site-head nav{order:3;flex-basis:100%;gap:12px}.site-head nav a{font-size:12px}.hero{padding-top:36px}.hero p{font-size:16px}.content section{padding:18px}.content h2{font-size:21px}.bottom-cta-card{padding:22px}.bottom-cta-card a{width:100%;text-align:center}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}'
  const html = [
    '<!doctype html>',
    '<html lang="' + page.lang + '"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#0b211d">',
    '<meta name="description" content="' + escapeHtml(page.description) + '">',
    '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<title>' + escapeHtml(page.title) + '</title>',
    '<link rel="canonical" href="' + canonical + '">',
    alternates(page),
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<link rel="manifest" href="/site.webmanifest">',
    '<meta property="og:type" content="website"><meta property="og:site_name" content="LokPravaah">',
    '<meta property="og:title" content="' + escapeHtml(page.title) + '"><meta property="og:description" content="' + escapeHtml(page.description) + '">',
    '<meta property="og:url" content="' + canonical + '"><meta property="og:image" content="' + siteUrl + '/og-image.png"><meta property="og:image:alt" content="LokPravaah civic reporting platform">',
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + escapeHtml(page.title) + '"><meta name="twitter:description" content="' + escapeHtml(page.description) + '"><meta name="twitter:image" content="' + siteUrl + '/og-image.png">',
    '<script type="application/ld+json">' + jsonForHtml(schema) + '</script>',
    '<style>' + css + '</style></head><body>',
    '<header class="site-head"><a class="brand" href="' + homePath + '" aria-label="LokPravaah home"><img src="/favicon.svg" alt="" width="34" height="34"><span>LokPravaah</span></a><nav aria-label="' + (hindi ? 'मुख्य नेविगेशन' : 'Main navigation') + '">' + menu + '</nav><a class="head-cta" href="/">' + (hindi ? 'ऐप खोलें' : 'Open platform') + '</a></header>',
    '<main><section class="hero"><div class="hero-inner"><div class="breadcrumbs"><a href="' + homePath + '">LokPravaah</a> / ' + escapeHtml(page.section) + '</div><div class="eyebrow">' + (hindi ? 'स्वतंत्र नागरिक तकनीक मंच' : 'Independent civic-tech platform') + '</div><h1>' + escapeHtml(page.h1) + '</h1><p>' + escapeHtml(page.intro) + '</p><div class="hero-actions"><a class="primary" href="/">' + (hindi ? 'LokPravaah ऐप खोलें' : 'Open LokPravaah') + '</a><a class="secondary" href="' + (hindi ? '/hi/report-civic-issue/' : '/report-civic-issue/') + '">' + (hindi ? 'रिपोर्टिंग गाइड देखें' : 'Read the reporting guide') + '</a></div></div></section>',
    '<article class="content">' + page.body + '</article>',
    '<section class="bottom-cta"><div class="bottom-cta-card"><div><h2>' + (hindi ? 'स्थानीय चिंता को स्पष्ट रिकॉर्ड में बदलें।' : 'Turn a local concern into a clearer record.') + '</h2><p>' + (hindi ? 'LokPravaah में रिपोर्ट तैयार करें और प्लेटफ़ॉर्म पर दर्ज अपडेट देखें।' : 'Create a structured report and return to review updates recorded in the platform.') + '</p></div><a href="/">' + (hindi ? 'प्लेटफ़ॉर्म खोलें' : 'Open platform') + '</a></div></section></main>',
    '<footer class="site-foot"><strong>LokPravaah</strong> · ' + (hindi ? 'स्वतंत्र civic-tech परियोजना' : 'Independent civic-tech project') + '<div class="foot-links">' + related + '</div><p class="disclaimer">' + (hindi ? 'यह सरकारी पोर्टल या आपातकालीन सेवा नहीं है। रिपोर्ट दर्ज करने से सरकारी विभाग में स्वतः शिकायत नहीं जाती और समाधान की गारंटी नहीं है।' : 'LokPravaah is not an official government portal or an emergency service. Reports are not automatically sent to a government department and do not guarantee resolution.') + '</p></footer>',
    '</body></html>',
  ].filter(Boolean).join('\n')
  return html
}

for (const page of allPages.filter(page => page.path !== '/')) {
  const output = resolve(root, 'dist', '.' + page.path, 'index.html')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, renderPage(page), 'utf8')
}

const today = new Date().toISOString().slice(0, 10)
const sitemapRows = allPages.map(page => {
  const links = page.alternate && pageByPath.has(page.alternate)
    ? '<xhtml:link rel="alternate" hreflang="' + (page.lang === 'en-IN' ? 'hi-IN' : 'en-IN') + '" href="' + siteUrl + page.alternate + '"/>' +
      '<xhtml:link rel="alternate" hreflang="' + page.lang + '" href="' + siteUrl + page.path + '"/>' +
      '<xhtml:link rel="alternate" hreflang="x-default" href="' + siteUrl + (page.lang === 'en-IN' ? page.path : page.alternate) + '"/>'
    : ''
  return '<url><loc>' + siteUrl + page.path + '</loc><lastmod>' + today + '</lastmod>' + links + '</url>'
}).join('\n')
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + sitemapRows + '\n</urlset>\n'

await writeFile(resolve(root, 'dist', 'sitemap.xml'), sitemap, 'utf8')
await writeFile(resolve(root, 'dist', 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + siteUrl + '/sitemap.xml\n', 'utf8')
console.log('[SEO] Generated ' + allPages.length + ' crawlable pages, bilingual hreflang metadata, sitemap.xml and robots.txt for ' + siteUrl)

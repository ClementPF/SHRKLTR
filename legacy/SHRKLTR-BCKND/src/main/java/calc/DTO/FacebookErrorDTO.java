package calc.DTO;

/**
 *
 * @author danny
 */
public class FacebookErrorDTO {
    private Error error;

    public Error getError() {
        return error;
    }

    public void setError(Error error) {
        this.error = error;
    }
    
    public class Error {
        private String message;
        private String type;
        private String code;
        private String errorSubcode;
        private String fbtraceId;

        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getCode() {
            return code;
        }

        public void setCode(String code) {
            this.code = code;
        }

        public String getErrorSubcode() {
            return errorSubcode;
        }

        public void setErrorSubcode(String errorSubcode) {
            this.errorSubcode = errorSubcode;
        }

        public String getFbtraceId() {
            return fbtraceId;
        }

        public void setFbtraceId(String fbtraceId) {
            this.fbtraceId = fbtraceId;
        }
    }
}

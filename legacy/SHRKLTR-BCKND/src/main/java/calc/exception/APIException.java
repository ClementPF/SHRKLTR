package calc.exception;

import org.springframework.http.HttpStatus;

/**
 *
 * @author danny
 */
public class APIException extends RuntimeException {
    private HttpStatus httpStatus;

    public APIException(HttpStatus httpStatus, String message) {
        super(message);
        this.httpStatus = httpStatus;
    }

    public APIException(HttpStatus httpStatus, String message, Throwable cause) {
        super(message, cause);
        this.httpStatus = httpStatus;
    }

    public APIException(Class resourceClass, String exception, HttpStatus httpStatus) {
        super(resourceClass.getSimpleName() + " " +  exception);
        this.httpStatus = httpStatus;
    }

    public HttpStatus getHttpStatus() {
        return httpStatus;
    }
}

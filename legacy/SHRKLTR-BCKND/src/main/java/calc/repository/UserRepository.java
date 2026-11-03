package calc.repository;

import calc.entity.User;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UserRepository extends CrudRepository<User, Long> {
    List<User> findByLastName(String lastName);
    User findByUserName(String userName);
    User findByUserId(Long userId);
    User findByExternalId(String externalId);
}
